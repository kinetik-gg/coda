import { z } from 'zod';
import {
  SCREENPLAY_REBASE_PLAN_VERSION,
  screenplaySourceRangeSchema,
  screenplaySourceTextHashSchema,
  type ScreenplayRebaseClassification,
  type ScreenplaySourceRange,
} from './breakdown-screenplay';

// Applying a reviewed rebase (issue #243) — the one mutating step in the flow a breakdown's pins
// take when the screenplay they follow moves on.
//
// A leaf module beside `./breakdown-screenplay`, which it imports directly rather than through
// `./index`: the barrel re-exports both, so reaching for it here would be circular.
//
// The shape of this request is the whole safety argument. An apply never names a *new* anchor of its
// own invention; it names a plan by `fingerprint` and, per reference, chooses between the anchors
// that plan already listed. The server rebuilds the plan from live data inside the writing
// transaction, refuses when the rebuilt fingerprint differs by so much as one field, and refuses
// again when a chosen anchor is not one of the rebuilt plan's candidates. That is what makes
// "the reviewer approved *this* anchor" verifiable rather than asserted.

/**
 * The largest number of decisions one apply may carry.
 *
 * A decision is required for every reference the engine would not carry on its own, so this also
 * bounds the size of a rebasable breakdown in practice. Generous — a breakdown with more than a
 * thousand ambiguous pins has a bigger problem than this ceiling — but present, because the request
 * body is otherwise unbounded and every decision costs a lookup inside a serializable transaction.
 */
export const SCREENPLAY_REBASE_MAX_DECISIONS = 1_000;

/**
 * What a reviewer decided for one source reference.
 *
 * Exactly two actions, deliberately:
 *
 * - `keep` — leave the pin on the revision it is already cut from. Nothing is written for this
 *   reference and it stays `stale`. This is the "keep old pin" decision the issue requires as the
 *   alternative to naming a target, and it is always available, including for a `deleted` range
 *   where there is no target to name.
 * - `retarget` — move the pin to `source`. The range must be one the plan already offered as a
 *   candidate for this very reference, and `sourceTextHash` must be that candidate's hash. A
 *   reviewer therefore cannot invent an offset, and cannot approve an anchor whose text differs
 *   from the text they were shown.
 *
 * There is no third "accept the proposal" action. Accepting a proposal *is* a `retarget` at the
 * proposed range, so the recorded decision is identical whether the reviewer took the plan's
 * suggestion or picked a different candidate — an audit trail that cannot be read two ways.
 *
 * References the engine marked `autoApplicable` need no decision at all and carry over to their
 * proposed anchor. Supplying one for them anyway is allowed and overrides that: `keep` holds an
 * unchanged range back, `retarget` sends it somewhere the plan listed.
 */
export const screenplayRebaseDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      itemSourceReferenceId: z.string().uuid(),
      action: z.literal('keep'),
    })
    .strict(),
  z
    .object({
      itemSourceReferenceId: z.string().uuid(),
      action: z.literal('retarget'),
      /** Must equal one of the plan entry's candidate ranges exactly. */
      source: screenplaySourceRangeSchema,
      /** Must equal that candidate's `textHash` — the hash of the text the reviewer read. */
      sourceTextHash: screenplaySourceTextHashSchema,
    })
    .strict(),
]);
export type ScreenplayRebaseDecisionInput = z.infer<typeof screenplayRebaseDecisionSchema>;

/**
 * The apply request.
 *
 * `fingerprint` identifies the reviewed plan and is the only thing that carries it: the plan itself
 * is never sent back. A client that echoed the plan could edit it in flight, and the server would
 * have to decide which copy to believe. Naming the plan by digest instead means the server rebuilds
 * it from the database it is about to write to, and the digest either matches that rebuild or the
 * apply is refused.
 *
 * `planVersion` is checked before anything else so a client running against an older plan shape is
 * turned away rather than silently reinterpreted.
 */
export const applyScreenplayRebaseSchema = z
  .object({
    planVersion: z.literal(SCREENPLAY_REBASE_PLAN_VERSION),
    /** The reviewed plan's `fingerprint`, verbatim. */
    fingerprint: screenplaySourceTextHashSchema,
    decisions: z.array(screenplayRebaseDecisionSchema).max(SCREENPLAY_REBASE_MAX_DECISIONS),
  })
  .strict();
export type ApplyScreenplayRebaseInput = z.infer<typeof applyScreenplayRebaseSchema>;

/**
 * What actually happened to one reference.
 *
 * - `carried` — the engine proved the anchor and no human was asked. Only ever `unchanged` or
 *   `shifted-with-identical-text`, and only ever where the engine set `autoApplicable`.
 * - `retargeted` — a recorded decision moved the pin. Every `materially-changed`, `deleted`, or
 *   `ambiguous` reference that moved at all is in this bucket, and no other bucket can hold one.
 * - `kept` — the pin was not touched. It still resolves to its original revision and is still stale.
 */
export type ScreenplayRebaseOutcome = 'carried' | 'retargeted' | 'kept';

export interface ScreenplayRebaseAppliedReference {
  itemSourceReferenceId: string;
  itemId: string;
  outcome: ScreenplayRebaseOutcome;
  /** The plan's classification for this reference, so the result explains itself without the plan. */
  classification: ScreenplayRebaseClassification;
  /**
   * Whether a recorded decision authorised this outcome. False only for `carried`.
   *
   * The audit property the issue asks for reads directly off this field: no reference whose
   * classification is `materially-changed`, `deleted`, or `ambiguous` can appear with
   * `outcome: 'retargeted'` and `confirmed: false`.
   */
  confirmed: boolean;
  /** The range the pin now names, or `null` when the pin was kept. */
  source: ScreenplaySourceRange | null;
  /** Hash of the text at `source` in the target revision, or `null` when the pin was kept. */
  sourceTextHash: string | null;
}

/** Counts over {@link ScreenplayRebaseAppliedReference}, so a client need not tally them. */
export interface ScreenplayRebaseApplySummary {
  referenceCount: number;
  carriedCount: number;
  retargetedCount: number;
  keptCount: number;
  /** `carriedCount + retargetedCount` — the number of pins actually written. */
  movedCount: number;
}

/**
 * The result of a successful apply.
 *
 * `target.screenplayRevisionId` is never `null` here, unlike on a plan: the apply cuts the
 * `ScreenplayRevision` for the live version inside its own transaction, because a pin may only ever
 * name an immutable revision and the preview is forbidden from creating one.
 */
export interface ScreenplayRebaseApplyResult {
  planVersion: number;
  projectId: string;
  screenplayId: string;
  /** The fingerprint of the plan that was applied — the same one the request named. */
  fingerprint: string;
  target: {
    screenplayVersion: number;
    screenplayRevisionId: string;
    sourceTextHash: string;
  };
  applied: readonly ScreenplayRebaseAppliedReference[];
  summary: ScreenplayRebaseApplySummary;
  appliedAt: string;
}
