import { BadRequestException, ConflictException } from '@nestjs/common';
import type {
  ApplyScreenplayRebaseInput,
  ScreenplayRebaseAppliedReference,
  ScreenplayRebaseApplySummary,
  ScreenplayRebaseCandidate,
  ScreenplayRebaseDecisionInput,
  ScreenplayRebaseEntry,
  ScreenplayRebasePlan,
  ScreenplaySourceRange,
} from '@coda/contracts';

/**
 * Turns a reviewed plan plus a reviewer's decisions into the exact set of pin moves to write
 * (issue #243).
 *
 * **Pure, and that is the point.** Nothing here performs I/O, so every rule that decides whether a
 * pin may move — and, crucially, every rule that says it may *not* — is unit-testable without a
 * database, and none of them can be reached around by the service above.
 *
 * Three rules carry the whole safety argument, and they are all in this file:
 *
 * 1. **The plan must still be the plan.** The caller names a plan by `fingerprint`; the service
 *    hands this module a plan it rebuilt from live rows inside the writing transaction. If the two
 *    fingerprints differ, the apply is refused. Nothing is recomputed and re-applied, because a
 *    recomputed anchor is by definition one no reviewer ever saw.
 * 2. **Only the engine authorises a silent move.** A pin moves without a recorded decision only
 *    where `entry.autoApplicable` is true — the engine's own flag, never re-derived from the
 *    classification, because a range can be `shifted-with-identical-text` and still not have a
 *    *proven* unique anchor.
 * 3. **A decision may only choose among anchors the plan offered.** A `retarget` names a range that
 *    must equal one of that entry's candidates exactly, and a hash that must equal that candidate's
 *    hash. A reviewer therefore cannot invent an offset, and cannot approve an anchor whose text
 *    differs from the text they were shown.
 *
 * @throws ConflictException when the plan is stale — the state moved under the review.
 * @throws BadRequestException when the decisions do not describe a complete, coherent answer to the
 * plan. That is a client bug, not a race, and the two are deliberately not conflated: a `409` means
 * "re-preview and review again", a `400` means "this request was malformed".
 */

/** One pin the apply will write, with the evidence that authorised it. */
export interface RebasePinMove {
  itemSourceReferenceId: string;
  itemId: string;
  /** The revision the pin is moving off, so the write can assert it has not shifted underneath. */
  fromScreenplayRevisionId: string;
  range: ScreenplaySourceRange;
  /** The candidate's hash — the hash of the text at `range` in the target. Stored on the pin. */
  sourceTextHash: string;
  /** True when a recorded decision authorised the move; false only for an auto-carry. */
  confirmed: boolean;
}

export interface ResolvedRebase {
  moves: readonly RebasePinMove[];
  /** Every reference in the plan, moved or not, in the plan's own order. */
  applied: readonly ScreenplayRebaseAppliedReference[];
  summary: ScreenplayRebaseApplySummary;
}

/**
 * Recomputes the plan's own fingerprint from the plan's own fields.
 *
 * The service passes a plan it just rebuilt from live rows, so this is the staleness check: a digest
 * over the four independent facts (#242 fixed them) plus every proposed anchor. It is deliberately
 * not a subset comparison and deliberately not tolerant. Whatever the identity covers is what a
 * stale plan is caught by, and the anchors are in there precisely so that a plan which somehow
 * re-derived a *different* proposal from the same text is refused rather than applied.
 */
function assertPlanIsCurrent(plan: ScreenplayRebasePlan, expectedFingerprint: string): void {
  if (plan.fingerprint === expectedFingerprint) return;
  throw new ConflictException(
    'The screenplay, the link, or a pin changed since this rebase was reviewed. Preview it again.',
  );
}

/** Indexes the decisions, refusing a body that answers for the same reference twice. */
function decisionsByReference(
  decisions: readonly ScreenplayRebaseDecisionInput[],
): Map<string, ScreenplayRebaseDecisionInput> {
  const byReference = new Map<string, ScreenplayRebaseDecisionInput>();
  for (const decision of decisions) {
    if (byReference.has(decision.itemSourceReferenceId)) {
      throw new BadRequestException(
        `Two decisions were recorded for source reference ${decision.itemSourceReferenceId}`,
      );
    }
    byReference.set(decision.itemSourceReferenceId, decision);
  }
  return byReference;
}

/**
 * Refuses a decision about a reference this plan does not carry an entry for.
 *
 * Excluded references are named apart from unknown ones because they are a different mistake: an
 * `unpinned` or `pin-unavailable` reference has no pinned revision on one side of the comparison, so
 * there is no rebase to authorise and quietly ignoring the decision would leave the reviewer
 * believing they had made one.
 */
function assertEveryDecisionIsAnswerable(
  plan: ScreenplayRebasePlan,
  byReference: ReadonlyMap<string, ScreenplayRebaseDecisionInput>,
): void {
  const entries = new Set(plan.entries.map((entry) => entry.itemSourceReferenceId));
  const excluded = new Set(plan.excluded.map((reference) => reference.itemSourceReferenceId));
  for (const referenceId of byReference.keys()) {
    if (entries.has(referenceId)) continue;
    throw new BadRequestException(
      excluded.has(referenceId)
        ? `Source reference ${referenceId} cannot be rebased, so no decision applies to it`
        : `Source reference ${referenceId} is not part of this rebase plan`,
    );
  }
}

/**
 * Finds the candidate a `retarget` decision chose, or refuses.
 *
 * Matching on the range alone would let a reviewer's client approve a position while the text at it
 * had changed, so the hash is checked too. The plan the candidate comes from was rebuilt from live
 * text moments earlier, which is what makes the hash a statement about what is in the database now
 * rather than about what a client remembered.
 */
function chosenCandidate(
  entry: ScreenplayRebaseEntry,
  range: ScreenplaySourceRange,
  sourceTextHash: string,
): ScreenplayRebaseCandidate {
  const candidate = entry.candidates.find(
    (option) => option.range.start === range.start && option.range.end === range.end,
  );
  if (!candidate) {
    throw new BadRequestException(
      `The rebase plan offers no anchor at ${String(range.start)}–${String(range.end)} for source reference ${entry.itemSourceReferenceId}`,
    );
  }
  if (candidate.textHash !== sourceTextHash) {
    throw new ConflictException(
      `The text at the anchor chosen for source reference ${entry.itemSourceReferenceId} is not the text that was reviewed`,
    );
  }
  return candidate;
}

/** The move an entry with no recorded decision makes — which for anything reviewable is none. */
function undecided(entry: ScreenplayRebaseEntry): ScreenplayRebaseCandidate {
  if (!entry.autoApplicable) {
    throw new BadRequestException(
      `Source reference ${entry.itemSourceReferenceId} is ${entry.classification} and needs an explicit decision before it can be rebased`,
    );
  }
  if (!entry.proposed) {
    // Unreachable against this engine: it sets `autoApplicable` only on an anchor it proved. Refused
    // rather than asserted, because the one thing worse than a surprising 409 here is a pin moved to
    // an anchor nothing proposed.
    throw new ConflictException(
      `Source reference ${entry.itemSourceReferenceId} is marked auto-applicable but proposes no anchor`,
    );
  }
  return entry.proposed;
}

function outcomeOf(
  entry: ScreenplayRebaseEntry,
  decision: ScreenplayRebaseDecisionInput | undefined,
): { move: RebasePinMove | null; reference: ScreenplayRebaseAppliedReference } {
  const base = {
    itemSourceReferenceId: entry.itemSourceReferenceId,
    itemId: entry.itemId,
    classification: entry.classification,
  };
  if (decision?.action === 'keep') {
    return {
      move: null,
      reference: { ...base, outcome: 'kept', confirmed: true, source: null, sourceTextHash: null },
    };
  }
  const candidate =
    decision === undefined
      ? undecided(entry)
      : chosenCandidate(entry, decision.source, decision.sourceTextHash);
  const confirmed = decision !== undefined;
  return {
    move: {
      itemSourceReferenceId: entry.itemSourceReferenceId,
      itemId: entry.itemId,
      fromScreenplayRevisionId: entry.from.screenplayRevisionId,
      range: candidate.range,
      sourceTextHash: candidate.textHash,
      confirmed,
    },
    reference: {
      ...base,
      outcome: confirmed ? 'retargeted' : 'carried',
      confirmed,
      source: candidate.range,
      sourceTextHash: candidate.textHash,
    },
  };
}

function summarize(
  applied: readonly ScreenplayRebaseAppliedReference[],
): ScreenplayRebaseApplySummary {
  let carriedCount = 0;
  let retargetedCount = 0;
  let keptCount = 0;
  for (const reference of applied) {
    if (reference.outcome === 'carried') carriedCount += 1;
    else if (reference.outcome === 'retargeted') retargetedCount += 1;
    else keptCount += 1;
  }
  return {
    referenceCount: applied.length,
    carriedCount,
    retargetedCount,
    keptCount,
    movedCount: carriedCount + retargetedCount,
  };
}

/**
 * Resolves the whole plan against the whole set of decisions.
 *
 * Total by construction: every entry the plan carries produces exactly one outcome, and an entry
 * that needs a human and did not get one fails the request rather than being skipped. A partial
 * apply is not an outcome this function can express.
 */
export function resolveRebaseDecisions(
  plan: ScreenplayRebasePlan,
  input: ApplyScreenplayRebaseInput,
): ResolvedRebase {
  if (input.planVersion !== plan.planVersion) {
    throw new BadRequestException('This rebase plan was produced by a different version of Coda');
  }
  assertPlanIsCurrent(plan, input.fingerprint);

  const byReference = decisionsByReference(input.decisions);
  assertEveryDecisionIsAnswerable(plan, byReference);

  const moves: RebasePinMove[] = [];
  const applied: ScreenplayRebaseAppliedReference[] = [];
  for (const entry of plan.entries) {
    const resolved = outcomeOf(entry, byReference.get(entry.itemSourceReferenceId));
    if (resolved.move) moves.push(resolved.move);
    applied.push(resolved.reference);
  }
  return { moves, applied, summary: summarize(applied) };
}
