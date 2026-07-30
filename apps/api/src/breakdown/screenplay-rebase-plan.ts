import { createHash } from 'node:crypto';
import {
  SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH,
  SCREENPLAY_REBASE_PLAN_VERSION,
  SCREENPLAY_SOURCE_OFFSET_UNIT,
  pinStaleness,
  screenplayRebasePlanIdentity,
  type ScreenplayRebaseCandidate,
  type ScreenplayRebaseClassification,
  type ScreenplayRebaseEntry,
  type ScreenplayRebaseExcerpt,
  type ScreenplayRebaseExcludedReference,
  type ScreenplayRebaseFingerprintEntry,
  type ScreenplayRebasePlan,
  type ScreenplayRebaseSourceRevision,
  type ScreenplayRebaseSummary,
  type ScreenplayRebaseTarget,
} from '@coda/contracts';
import {
  compareScreenplaySources,
  type ScreenplayRangeCandidate,
  type ScreenplayRangeComparison,
} from '@coda/fountain';
import type { PinRow } from './source-revision-pin';

/**
 * Assembles the rebase plan (issue #242) from evidence already read out of the database.
 *
 * **Pure, and that is the point.** Nothing in this module performs I/O, so the one function that
 * turns pins plus screenplay text into a plan is structurally incapable of writing anything. The
 * service above it does the reading; the apply step (#243) does the writing. Keeping the assembly
 * here also means every unhappy path — an ambiguous range with several candidates, a deleted one, a
 * pin whose recorded hash disagrees with its own revision — is unit-testable without a database.
 *
 * Nothing here decides anything the compare engine already decided. `classification`, `reason`, and
 * `autoApplicable` are copied off `ScreenplayRangeComparison` verbatim. In particular
 * `autoApplicable` is never re-derived from the classification: the engine sets it only on an anchor
 * it *proved* unique, and second-guessing that is exactly how a silent mis-anchor would get in.
 *
 * @throws ScreenplayComparisonError when a stored pin cannot describe a comparison at all — a range
 * outside the immutable revision it names, or a source past the engine's ceiling. Those are
 * impossible against data the pin route wrote, so they signal a corrupt row rather than a review
 * decision, and are deliberately not swallowed into a classification.
 */

/** One distinct revision's text, keyed in {@link ScreenplayRebasePlanInput.revisions} by its id. */
export interface RebaseSourceRevision {
  screenplayVersion: number;
  sourceText: string;
}

/** A source reference in the order it should be reviewed. */
export interface RebaseReference {
  id: string;
  itemId: string;
}

export interface ScreenplayRebasePlanInput {
  projectId: string;
  screenplayId: string;
  linkUpdatedAt: Date;
  /**
   * The screenplay's live, mutable text and version — never a revision's.
   *
   * `screenplayRevisionId` is whatever revision already happens to exist for that version, or
   * `null`. The preview looks; it never cuts one. #243 creates or reuses it inside the transaction
   * that is allowed to write, and refuses if the live version has moved past `screenplayVersion` by
   * then.
   */
  target: { screenplayVersion: number; screenplayRevisionId: string | null; sourceText: string };
  references: readonly RebaseReference[];
  /** Pins by `itemSourceReferenceId`. A reference absent here is `unpinned`. */
  pins: ReadonlyMap<string, PinRow>;
  /** Readable revision text by id. A pin naming a revision absent here is `pin-unavailable`. */
  revisions: ReadonlyMap<string, RebaseSourceRevision>;
  computedAt: Date;
}

/**
 * Full-source scans allowed per distinct source revision.
 *
 * The engine's own default. Ranges resolved from an unchanged prefix or suffix cost nothing, so a
 * screenplay edited in one place spends a handful of passes however many references point into it.
 * Budget is granted per revision rather than shared across them so that one revision full of
 * repeated dialogue cannot starve another into a false `search-budget-exhausted`.
 */
const MAX_SEARCH_PASSES_PER_REVISION = 128;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Cuts display text to the contract's ceiling while leaving the hash covering the whole excerpt.
 *
 * The hash is the evidence #243 verifies against, so it must never describe only the part a reviewer
 * happened to be shown.
 */
function excerpt(
  range: { start: number; end: number },
  text: string,
  hash: string,
): ScreenplayRebaseExcerpt {
  const truncated = text.length > SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH;
  return {
    range: { start: range.start, end: range.end },
    text: truncated ? text.slice(0, SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH) : text,
    textTruncated: truncated,
    textHash: hash,
  };
}

function candidateOf(candidate: ScreenplayRangeCandidate): ScreenplayRebaseCandidate {
  return {
    ...excerpt(candidate.range, candidate.text, candidate.textHash),
    identicalText: candidate.identicalText,
    atSourceOffset: candidate.atSourceOffset,
    shift: candidate.shift,
    contextCodeUnits: candidate.contextCodeUnits,
  };
}

function entryOf(
  reference: RebaseReference,
  pin: PinRow,
  revision: RebaseSourceRevision,
  comparison: ScreenplayRangeComparison,
  targetVersion: number,
): ScreenplayRebaseEntry {
  return {
    itemSourceReferenceId: reference.id,
    itemId: reference.itemId,
    classification: comparison.classification,
    reason: comparison.reason,
    autoApplicable: comparison.autoApplicable,
    decisionRequired: !comparison.autoApplicable,
    staleness: pinStaleness(pin.screenplayVersion, targetVersion),
    from: {
      screenplayRevisionId: pin.screenplayRevisionId,
      screenplayVersion: revision.screenplayVersion,
      pinUpdatedAt: pin.updatedAt.toISOString(),
      excerpt: excerpt(comparison.source.range, comparison.source.text, comparison.source.textHash),
      recordedTextHash: pin.sourceTextHash,
      // The engine reports `null` only when no recorded hash was supplied, and one always is here.
      recordedTextHashMatches: comparison.source.recordedTextHashMatches !== false,
    },
    proposed: comparison.target ? candidateOf(comparison.target) : null,
    candidates: comparison.candidates.map(candidateOf),
    candidatesTruncated: comparison.candidatesTruncated,
  };
}

/** Splits references into the pinned ones worth comparing and the ones that cannot be rebased. */
function partition(input: ScreenplayRebasePlanInput): {
  comparable: { reference: RebaseReference; pin: PinRow; revision: RebaseSourceRevision }[];
  excluded: ScreenplayRebaseExcludedReference[];
} {
  const comparable: { reference: RebaseReference; pin: PinRow; revision: RebaseSourceRevision }[] =
    [];
  const excluded: ScreenplayRebaseExcludedReference[] = [];
  for (const reference of input.references) {
    const pin = input.pins.get(reference.id);
    if (!pin) {
      excluded.push({
        itemSourceReferenceId: reference.id,
        itemId: reference.itemId,
        reason: 'unpinned',
      });
      continue;
    }
    const revision = input.revisions.get(pin.screenplayRevisionId);
    if (!revision) {
      excluded.push({
        itemSourceReferenceId: reference.id,
        itemId: reference.itemId,
        reason: 'pin-unavailable',
      });
      continue;
    }
    comparable.push({ reference, pin, revision });
  }
  return { comparable, excluded };
}

type Comparable = { reference: RebaseReference; pin: PinRow; revision: RebaseSourceRevision };

/**
 * Compares once per distinct source revision rather than once per pin.
 *
 * Two pins cut from the same revision share one alignment of that revision against the target, which
 * is what keeps the work proportional to the number of revisions in play rather than to the number
 * of references.
 */
function compareByRevision(
  comparable: readonly Comparable[],
  targetText: string,
): {
  comparisons: Map<string, ScreenplayRangeComparison>;
  maxPasses: number;
  passesUsed: number;
  exhausted: boolean;
} {
  const groups = new Map<string, Comparable[]>();
  for (const item of comparable) {
    const group = groups.get(item.pin.screenplayRevisionId);
    if (group) group.push(item);
    else groups.set(item.pin.screenplayRevisionId, [item]);
  }

  const comparisons = new Map<string, ScreenplayRangeComparison>();
  let passesUsed = 0;
  let exhausted = false;
  for (const group of groups.values()) {
    const result = compareScreenplaySources({
      sourceText: group[0]!.revision.sourceText,
      targetText,
      ranges: group.map(({ reference, pin }) => ({
        id: reference.id,
        range: { start: pin.sourceStart, end: pin.sourceEnd },
        recordedTextHash: pin.sourceTextHash,
      })),
      options: { maxSearchPasses: MAX_SEARCH_PASSES_PER_REVISION },
    });
    for (const comparison of result.ranges) comparisons.set(comparison.id, comparison);
    passesUsed += result.budget.searchPassesUsed;
    exhausted ||= result.budget.exhausted;
  }
  return {
    comparisons,
    maxPasses: MAX_SEARCH_PASSES_PER_REVISION * groups.size,
    passesUsed,
    exhausted,
  };
}

function summarize(
  entries: readonly ScreenplayRebaseEntry[],
  excludedCount: number,
): ScreenplayRebaseSummary {
  const byClassification: Record<ScreenplayRebaseClassification, number> = {
    unchanged: 0,
    'shifted-with-identical-text': 0,
    'materially-changed': 0,
    deleted: 0,
    ambiguous: 0,
  };
  let autoCarryCount = 0;
  for (const entry of entries) {
    byClassification[entry.classification] += 1;
    if (entry.autoApplicable) autoCarryCount += 1;
  }
  return {
    referenceCount: entries.length,
    autoCarryCount,
    decisionCount: entries.length - autoCarryCount,
    byClassification,
    excludedCount,
  };
}

function fingerprintEntry(entry: ScreenplayRebaseEntry): ScreenplayRebaseFingerprintEntry {
  return {
    itemSourceReferenceId: entry.itemSourceReferenceId,
    screenplayRevisionId: entry.from.screenplayRevisionId,
    screenplayVersion: entry.from.screenplayVersion,
    pinUpdatedAt: entry.from.pinUpdatedAt,
    source: entry.from.excerpt.range,
    sourceTextHash: entry.from.excerpt.textHash,
    recordedTextHash: entry.from.recordedTextHash,
    classification: entry.classification,
    autoApplicable: entry.autoApplicable,
    proposed: entry.proposed?.range ?? null,
  };
}

function sourceRevisionsOf(comparable: readonly Comparable[]): ScreenplayRebaseSourceRevision[] {
  const seen = new Map<string, ScreenplayRebaseSourceRevision>();
  for (const { pin, revision } of comparable) {
    if (seen.has(pin.screenplayRevisionId)) continue;
    seen.set(pin.screenplayRevisionId, {
      screenplayRevisionId: pin.screenplayRevisionId,
      screenplayVersion: revision.screenplayVersion,
      sourceTextHash: sha256Hex(revision.sourceText),
      sourceLength: revision.sourceText.length,
    });
  }
  return [...seen.values()].sort((left, right) => left.screenplayVersion - right.screenplayVersion);
}

/** Builds the plan. Reads nothing, writes nothing — every input is already in memory. */
export function buildScreenplayRebasePlan(input: ScreenplayRebasePlanInput): ScreenplayRebasePlan {
  const { comparable, excluded } = partition(input);
  const compared = compareByRevision(comparable, input.target.sourceText);

  const entries: ScreenplayRebaseEntry[] = [];
  for (const { reference, pin, revision } of comparable) {
    const comparison = compared.comparisons.get(reference.id);
    // Unreachable: the engine echoes one result per query, in order. Guarded rather than asserted
    // so a future engine change degrades to a short plan instead of a thrown request.
    if (!comparison) continue;
    entries.push(entryOf(reference, pin, revision, comparison, input.target.screenplayVersion));
  }

  const target: ScreenplayRebaseTarget = {
    screenplayVersion: input.target.screenplayVersion,
    screenplayRevisionId: input.target.screenplayRevisionId,
    sourceTextHash: sha256Hex(input.target.sourceText),
    sourceLength: input.target.sourceText.length,
  };
  const linkUpdatedAt = input.linkUpdatedAt.toISOString();
  const identity = screenplayRebasePlanIdentity({
    planVersion: SCREENPLAY_REBASE_PLAN_VERSION,
    projectId: input.projectId,
    screenplayId: input.screenplayId,
    linkUpdatedAt,
    target,
    entries: entries.map(fingerprintEntry),
    excluded,
  });

  return {
    planVersion: SCREENPLAY_REBASE_PLAN_VERSION,
    offsetUnit: SCREENPLAY_SOURCE_OFFSET_UNIT,
    projectId: input.projectId,
    screenplayId: input.screenplayId,
    linkUpdatedAt,
    target,
    sourceRevisions: sourceRevisionsOf(comparable),
    entries,
    excluded,
    summary: summarize(entries, excluded.length),
    budget: {
      maxSearchPasses: compared.maxPasses,
      searchPassesUsed: compared.passesUsed,
      exhausted: compared.exhausted,
    },
    computedAt: input.computedAt.toISOString(),
    fingerprint: sha256Hex(identity),
  };
}
