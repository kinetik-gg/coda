import { z } from 'zod';

// The contract surface where a breakdown meets a screenplay: which screenplay the breakdown follows
// (#238) and which immutable revision plus source range each of its source references is pinned to
// (#239). A leaf module — it imports nothing from `./index`, which re-exports it — so
// `packages/fountain` and the rebase flow can depend on the range contract alone.

const linkUuidSchema = z.string().uuid();

// --- Which screenplay a breakdown follows ------------------------------------

/**
 * A breakdown follows at most one screenplay (issue #238), matching the existing "one active
 * source PDF per breakdown" invariant. Linking is therefore an idempotent replace, not an append,
 * and the link lives beside — never inside — the PDF source-reference graph: an existing
 * `ItemSourceReference` resolves to exactly the same document and pages whether a link exists or
 * not.
 */
export const linkBreakdownScreenplaySchema = z.object({ screenplayId: linkUuidSchema }).strict();
export type LinkBreakdownScreenplayInput = z.infer<typeof linkBreakdownScreenplaySchema>;

/**
 * `screenplay` is `null` whenever the linked screenplay is unreadable by the caller, trashed, or
 * already purged. The link row itself is still reported so the breakdown can show and clear a
 * dangling link instead of silently hiding it.
 */
export interface BreakdownScreenplayLinkView {
  projectId: string;
  screenplayId: string;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
  screenplay: { id: string; title: string; filename: string; version: number } | null;
}

/**
 * Every screenplay-link route answers with this shape, including the routes that clear the link, so
 * a client never has to infer capability from an absent link. `canLink` mirrors the server's own
 * guard: a control the API would reject is not offered.
 */
export interface BreakdownScreenplayLinkState {
  link: BreakdownScreenplayLinkView | null;
  canLink: boolean;
}

// --- The screenplay source-range contract ------------------------------------
//
// Issue #239 pins a breakdown source reference to an immutable `ScreenplayRevision` plus an
// explicitly defined range inside that revision's Fountain source. Everything downstream —
// stale indicators (#240), the compare/re-anchor engine in `packages/fountain` (#241), and the
// rebase preview/apply flow (#242, #243) — reads the range through this module, so the unit and
// the bounds are fixed here once and are not re-derived anywhere else.
//
// **The unit is a UTF-16 code-unit index into `ScreenplayRevision.sourceText` exactly as stored.**
// That is a plain JavaScript string index: `sourceText.slice(start, end)` is the pinned excerpt,
// with no normalisation, no line-ending rewriting, and no Unicode folding applied first. It matches
// `FountainRange` in `packages/fountain`, which is what the parser already emits, so a parsed
// element range can be pinned without conversion.
//
// It is deliberately **not** a byte offset. `ScreenplayRevision.sourceByteLength` counts UTF-8
// bytes and is not interchangeable with these offsets; a range that came from a byte count must be
// converted before it reaches this contract. It is also not a page number: the legacy
// `ItemSourceReference.startPage`/`endPage` pair keeps describing the PDF and is untouched by a pin.

/**
 * The offset unit every screenplay source range is expressed in. Exported as a value so a client,
 * a fixture, or a persisted payload can assert the unit it was built against rather than assuming.
 */
export const SCREENPLAY_SOURCE_OFFSET_UNIT = 'utf16-code-unit';
export type ScreenplaySourceOffsetUnit = typeof SCREENPLAY_SOURCE_OFFSET_UNIT;

/**
 * The largest offset a range may name. Equal to `FOUNTAIN_SOURCE_MAX_CHARACTERS`, the ceiling the
 * screenplay source contract already enforces, so a valid range can never point past the longest
 * source the product accepts. Duplicated as its own constant rather than imported to keep this
 * module a leaf (`index.ts` re-exports it, so importing from there would be circular).
 */
export const SCREENPLAY_SOURCE_MAX_OFFSET = 5_000_000;

/**
 * A half-open range `[start, end)` of UTF-16 code units in a revision's `sourceText`.
 *
 * Half-open and non-empty are both load-bearing. Half-open makes `end - start` the exact excerpt
 * length and makes two adjacent ranges shareable at a single boundary offset, which is what the
 * compare engine needs to reason about an insertion *between* ranges. Non-empty means a pin always
 * quotes real text, so a hash of the excerpt is always meaningful evidence.
 */
export const screenplaySourceRangeSchema = z
  .object({
    start: z.number().int().min(0).max(SCREENPLAY_SOURCE_MAX_OFFSET),
    end: z.number().int().min(1).max(SCREENPLAY_SOURCE_MAX_OFFSET),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: 'end must be greater than start',
    path: ['end'],
  });
export type ScreenplaySourceRange = z.infer<typeof screenplaySourceRangeSchema>;

/**
 * The digest algorithm for `sourceTextHash`: lowercase hex SHA-256 of the UTF-8 encoding of
 * `sourceText.slice(start, end)`.
 *
 * The pinned revision already stores the full text, so the hash is not needed to recover the
 * excerpt. It exists so a comparison can reject a range whose stored text no longer matches the
 * revision it claims to come from, and so #242 can put a cheap stable fingerprint in a rebase plan
 * and detect a plan built against different text without shipping the excerpt back for comparison.
 */
export const SCREENPLAY_SOURCE_TEXT_HASH_ALGORITHM = 'sha256';
export const screenplaySourceTextHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

// --- Pinning a breakdown source reference ------------------------------------

/**
 * Pins an existing `ItemSourceReference` to a screenplay revision.
 *
 * `screenplayVersion` is the mutable `Screenplay.version` the client read the range out of, not a
 * revision id. The server creates or reuses the `ScreenplayRevision` for exactly that version and
 * rejects the request when the screenplay has already moved on, so a pin can never quote text from
 * one version at offsets the user selected in another. That is the same optimistic-concurrency
 * shape as `createScreenplayCheckpointSchema`, and a client that has just rendered the editor
 * already has the number.
 *
 * A pin is an idempotent replace: `PUT` twice with the same body and the same pin results.
 */
export const pinSourceReferenceRevisionSchema = z
  .object({
    screenplayVersion: z.number().int().min(1),
    source: screenplaySourceRangeSchema,
  })
  .strict();
export type PinSourceReferenceRevisionInput = z.infer<typeof pinSourceReferenceRevisionSchema>;

/**
 * The stored pin, without the excerpt text.
 *
 * This is the shape that rides along on a breakdown item read, where returning every excerpt would
 * make a page of items arbitrarily large. `screenplayVersion` is the pinned revision's
 * `screenplayVersion`, denormalised onto the pin so #240 can decide "the screenplay has moved on"
 * by comparing it with the live `Screenplay.version` without loading a single revision row.
 */
export interface SourceReferenceRevisionPinView {
  itemSourceReferenceId: string;
  screenplayId: string;
  screenplayRevisionId: string;
  screenplayVersion: number;
  source: ScreenplaySourceRange;
  sourceTextHash: string;
  sourceOffsetUnit: ScreenplaySourceOffsetUnit;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A pin resolved against the revision it names, which is the whole point of #239: `sourceText` is
 * read out of the immutable `ScreenplayRevision`, so a later REST or collaborative edit to
 * `Screenplay.sourceText` cannot change it.
 *
 * `resolution` distinguishes the three honest outcomes, because no foreign key protects the plain
 * `screenplay_revision_id`:
 *
 * - `pinned` — the revision exists and the excerpt was read from it.
 * - `unavailable` — the pin row exists but its revision is gone (the screenplay was purged) or the
 *   caller may not read the screenplay. `sourceText` is `null`; the reference still resolves to its
 *   PDF and pages through the legacy fields.
 * - `unpinned` — there is no pin. This is the legacy state every pre-existing reference is in, and
 *   #239 deliberately invents no backfill to leave it.
 */
export type SourceReferenceResolutionState = 'pinned' | 'unavailable' | 'unpinned';

export interface ResolvedSourceReferenceView {
  id: string;
  itemId: string;
  sourceDocumentId: string;
  startPage: number;
  endPage: number;
  position: string;
  resolution: SourceReferenceResolutionState;
  pin: SourceReferenceRevisionPinView | null;
  /** The exact excerpt from the pinned revision, or `null` unless `resolution` is `pinned`. */
  sourceText: string | null;
}

// --- Surfacing a stale pin (#240) ---------------------------------------------

/**
 * Whether a `pinned` reference's revision still matches the screenplay's live, mutable `version`.
 *
 * Deliberately **orthogonal** to {@link SourceReferenceResolutionState}: only a `pinned` reference
 * can be `current` or `stale` at all, because staleness compares two version numbers and an
 * `unavailable` or `unpinned` reference has nothing on one side of that comparison. Never merged
 * into `resolution` — doing so would collapse "the pin itself is broken" and "the pin still works
 * but the screenplay moved on" into one enum, which is exactly the ambiguity #239 built the
 * three-state `resolution` to avoid.
 *
 * - `current` — the pin's revision was cut from the screenplay's live version; nothing has changed.
 * - `stale` — the linked screenplay has advanced past the version the pin was cut from, whether by a
 *   direct edit or a collaborative session. The pinned reference's resolved text, offsets, PDF id,
 *   and pages are untouched by this — staleness is a display signal only. Re-anchoring the pin to
 *   the new version is out of scope here; see #241 (compare/re-anchor engine) and #242/#243
 *   (rebase preview/apply).
 */
export type SourceReferencePinStaleness = 'current' | 'stale';

/**
 * Compares the version a pin's revision was cut from against the screenplay's live version, the
 * exact comparison `screenplayVersion` was denormalised onto the pin to make joinless (see the pin
 * contract above). A pure function so the direction of the comparison — "stale" means the live
 * version has moved *past* the pinned one, not merely differs from it — is defined exactly once.
 */
export function pinStaleness(
  pinnedScreenplayVersion: number,
  liveScreenplayVersion: number,
): SourceReferencePinStaleness {
  return liveScreenplayVersion > pinnedScreenplayVersion ? 'stale' : 'current';
}

/**
 * The lightweight per-reference staleness summary that rides along on a bulk breakdown item read
 * (list items, get one item) — see the doc comment on `SourceReferenceRevisionPinView` for why an
 * excerpt never travels in bulk. `staleness` is `null` whenever `resolution` is not `pinned`: an
 * `unavailable` or `unpinned` reference has no live-version comparison to report.
 */
export interface SourceReferencePinSummary {
  resolution: SourceReferenceResolutionState;
  pin: SourceReferenceRevisionPinView | null;
  staleness: SourceReferencePinStaleness | null;
}

// --- Previewing a rebase onto a newer version (#242) --------------------------
//
// A rebase plan is the reviewable, **read-only** answer to "what would happen if this breakdown
// followed the screenplay's current text instead of the revisions its pins were cut from". Producing
// one writes nothing: no pin moves, no revision is cut, no screenplay changes. The apply step (#243)
// owns every mutation, and this plan is its input.
//
// Everything on the plan is either evidence read out of the database or a verdict the compare engine
// in `packages/fountain` already reached. Nothing here is re-derived from a rule that lives
// elsewhere — in particular `classification`, `reason`, and `autoApplicable` are copied straight off
// `ScreenplayRangeComparison`, so a plan explains itself without the reader inferring anything.

/**
 * The plan schema version, carried on every plan.
 *
 * A plan is handed back to #243 by a client that may be running older code than the server, so the
 * apply step must be able to reject a shape it does not understand before it reads any field.
 */
export const SCREENPLAY_REBASE_PLAN_VERSION = 1;
export type ScreenplayRebasePlanVersion = typeof SCREENPLAY_REBASE_PLAN_VERSION;

/**
 * Mirrors `ScreenplayRangeClassification` in `packages/fountain/src/compare/types.ts`.
 *
 * Mirrored rather than imported for the same leaf-module reason the offset constants are: this
 * package has no workspace dependency on `packages/fountain` and vice versa. Drift is a real risk,
 * so `compare-contract.test.ts` in that package reads this file off disk and fails when the two
 * vocabularies stop agreeing.
 */
export type ScreenplayRebaseClassification =
  'unchanged' | 'shifted-with-identical-text' | 'materially-changed' | 'deleted' | 'ambiguous';

/** Mirrors `ScreenplayComparisonReason`. See that type for what each ground means. */
export type ScreenplayRebaseReason =
  | 'identical-source-text'
  | 'inside-unchanged-prefix'
  | 'inside-unchanged-suffix'
  | 'unique-identical-match'
  | 'unique-identical-match-with-context'
  | 'replacement-region'
  | 'replacement-region-empty'
  | 'multiple-identical-matches'
  | 'recorded-hash-mismatch'
  | 'search-budget-exhausted';

/**
 * The only two classifications #243 may carry forward without a recorded human decision.
 *
 * Stated here as data so the preview UI can summarise "these need no attention" using the same rule
 * the apply step enforces. It is a cross-check, never the source of truth: the authority is the
 * engine's per-range `autoApplicable`, which additionally requires the anchor to have been *proven*
 * unique. A range may be `shifted-with-identical-text` and still not be auto-applicable, so a caller
 * must never widen its decision set by consulting this list instead of the flag.
 */
export const SCREENPLAY_REBASE_AUTO_CARRY_CLASSIFICATIONS = [
  'unchanged',
  'shifted-with-identical-text',
] as const satisfies readonly ScreenplayRebaseClassification[];

/**
 * Why a source reference is in the plan but not up for rebasing.
 *
 * Kept strictly apart from {@link SourceReferencePinStaleness}: an `unpinned` or `unavailable`
 * reference is not "stale", it has no pinned revision to compare against at all. Presenting either
 * as rebasable would invent a decision the user cannot meaningfully make, so they are reported in
 * their own bucket and the counts in {@link ScreenplayRebaseSummary} never fold them in.
 *
 * - `unpinned` — the reference has no revision pin. The legacy state of every pre-#239 reference.
 * - `pin-unavailable` — a pin row exists but its revision is gone, or the screenplay is unreadable.
 */
export type ScreenplayRebaseExclusionReason = 'unpinned' | 'pin-unavailable';

/**
 * The largest excerpt, in UTF-16 code units, a plan carries for display.
 *
 * A plan quotes old and new text so a reviewer can see the change, but a pinned range can be
 * arbitrarily long and a breakdown can reference hundreds of them. Text past this length is cut and
 * flagged. The hash beside it always covers the *whole* excerpt, so truncation never weakens the
 * evidence #243 verifies against — only what a human reads.
 */
export const SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH = 2_000;

/** A quoted stretch of screenplay text, with a hash that always covers the untruncated original. */
export interface ScreenplayRebaseExcerpt {
  range: ScreenplaySourceRange;
  /** Display text, cut to {@link SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH} code units. */
  text: string;
  /** True when `text` is shorter than `range.end - range.start`. */
  textTruncated: boolean;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of the full excerpt, per the contract hash rule. */
  textHash: string;
}

/**
 * A place in the target text a pinned range might belong, copied from the engine's candidate.
 *
 * Never a decision on its own. A plan with several of these on one entry is exactly the choice a
 * person has to make, and the preview must not pick for them.
 */
export interface ScreenplayRebaseCandidate extends ScreenplayRebaseExcerpt {
  /** Whether the candidate's text equals the pinned excerpt exactly. */
  identicalText: boolean;
  /** Whether the candidate starts at the pinned range's original offset. */
  atSourceOffset: boolean;
  /** `range.start - pinnedRange.start`. */
  shift: number;
  /** Code units of surrounding context the engine needed to isolate this candidate. `0` means none. */
  contextCodeUnits: number;
}

/** One pinned source reference, and how it re-anchors onto the target text. */
export interface ScreenplayRebaseEntry {
  itemSourceReferenceId: string;
  itemId: string;
  /** The engine's verdict. Copied, never recomputed. */
  classification: ScreenplayRebaseClassification;
  /** The engine's stated ground for that verdict, so the preview renders *why* rather than guessing. */
  reason: ScreenplayRebaseReason;
  /** The engine's own flag. #243 trusts this field and nothing else for silent carry-forward. */
  autoApplicable: boolean;
  /**
   * Whether a person must choose before this pin may move. Exactly `!autoApplicable`.
   *
   * Materialised on the entry rather than left to the client so "needs a human" is stated once, on
   * the server, in the same place the counts in {@link ScreenplayRebaseSummary} are derived.
   */
  decisionRequired: boolean;
  /** Whether the screenplay has moved past this pin's version. A `current` pin has nothing to move. */
  staleness: SourceReferencePinStaleness;
  from: {
    screenplayRevisionId: string;
    screenplayVersion: number;
    /** The pin row's `updatedAt`, ISO-8601. A pin re-pinned elsewhere invalidates the plan. */
    pinUpdatedAt: string;
    excerpt: ScreenplayRebaseExcerpt;
    /** The hash stored on the pin row when it was made. */
    recordedTextHash: string;
    /**
     * False when the pin's recorded hash disagrees with the text actually in its revision.
     *
     * Always paired with `classification: 'ambiguous'` and `reason: 'recorded-hash-mismatch'`: the
     * records contradict each other about what the range even says, so no re-anchor is trustworthy
     * and the engine refuses to propose one.
     */
    recordedTextHashMatches: boolean;
  };
  /**
   * The single anchor the plan proposes, or `null` when it proposes none.
   *
   * `null` for every `deleted` and every `ambiguous` entry, matching the engine: with nothing to
   * propose or several things to propose, showing one would be the silent guess this whole flow
   * exists to avoid. Set but *not* auto-applicable for `materially-changed`, where it is a region to
   * review rather than an answer.
   */
  proposed: ScreenplayRebaseCandidate | null;
  /** Every plausible anchor, ascending by offset. Two or more means the user picks one. */
  candidates: readonly ScreenplayRebaseCandidate[];
  /** True when more anchors exist than the engine was allowed to report. */
  candidatesTruncated: boolean;
}

/** A reference the plan lists but cannot rebase, with the honest reason. */
export interface ScreenplayRebaseExcludedReference {
  itemSourceReferenceId: string;
  itemId: string;
  reason: ScreenplayRebaseExclusionReason;
}

/**
 * The text every entry was compared *against*: the screenplay's live, mutable source.
 *
 * `screenplayRevisionId` is `null` whenever no `ScreenplayRevision` has been cut for
 * `screenplayVersion` yet — which is the normal case, because **the preview never cuts one**. #243
 * creates or reuses the revision for exactly this version as part of its transaction, and refuses
 * when the live version has moved past it. That keeps the preview free of side effects and keeps
 * revision creation inside the step that is allowed to write.
 */
export interface ScreenplayRebaseTarget {
  screenplayVersion: number;
  screenplayRevisionId: string | null;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of the whole target `sourceText`. */
  sourceTextHash: string;
  /** Length of the target `sourceText` in UTF-16 code units. */
  sourceLength: number;
}

/** A distinct revision some of the previewed pins were cut from. */
export interface ScreenplayRebaseSourceRevision {
  screenplayRevisionId: string;
  screenplayVersion: number;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of the whole revision `sourceText`. */
  sourceTextHash: string;
  sourceLength: number;
}

/** Bounded-work accounting, summed across every compared revision. */
export interface ScreenplayRebaseBudget {
  maxSearchPasses: number;
  searchPassesUsed: number;
  /** True when at least one range's search stopped early. Those ranges are `search-budget-exhausted`. */
  exhausted: boolean;
}

/**
 * Counts for the "unchanged ranges may be summarised, everything else is a decision" split.
 *
 * `autoCarryCount + decisionCount === referenceCount`, and `excludedCount` is counted apart because
 * an unpinned or unavailable reference is not a rebase decision.
 */
export interface ScreenplayRebaseSummary {
  referenceCount: number;
  autoCarryCount: number;
  decisionCount: number;
  byClassification: Record<ScreenplayRebaseClassification, number>;
  excludedCount: number;
}

/**
 * The reviewable, read-only rebase plan (#242).
 *
 * Every field that could change underneath a plan is carried on it, because #243 must be able to
 * reject a plan built against text that has since moved rather than recompute anchors and apply
 * different ones silently. Together, four independent facts pin the plan to a moment:
 *
 * 1. `target.screenplayVersion` plus `target.sourceTextHash` — the screenplay's live text. Any edit,
 *    REST or collaborative, bumps the version; the hash catches a version that was reused.
 * 2. `linkUpdatedAt` — re-pointing the breakdown at a different screenplay invalidates the plan even
 *    when `screenplayId` happens to match again.
 * 3. Each entry's `from.screenplayRevisionId` and `pinUpdatedAt` — a pin re-pinned in another tab is
 *    no longer the pin the plan reasoned about.
 * 4. `fingerprint` — one digest over all of the above plus every proposed anchor, so the cheap check
 *    is a single string comparison and the detailed fields exist to explain a mismatch.
 */
export interface ScreenplayRebasePlan {
  planVersion: ScreenplayRebasePlanVersion;
  /** Always `utf16-code-unit`. Stated so a stored plan asserts the unit it was built against. */
  offsetUnit: ScreenplaySourceOffsetUnit;
  projectId: string;
  screenplayId: string;
  /** The breakdown↔screenplay link row's `updatedAt`, ISO-8601. */
  linkUpdatedAt: string;
  target: ScreenplayRebaseTarget;
  /** Every distinct revision the previewed pins were cut from, ascending by version. */
  sourceRevisions: readonly ScreenplayRebaseSourceRevision[];
  /** One entry per `pinned` reference, in stable item-then-reference order. */
  entries: readonly ScreenplayRebaseEntry[];
  excluded: readonly ScreenplayRebaseExcludedReference[];
  summary: ScreenplayRebaseSummary;
  budget: ScreenplayRebaseBudget;
  /** When the plan was computed, ISO-8601. Display only; staleness is decided by the fields above. */
  computedAt: string;
  /** Lowercase hex SHA-256 of {@link screenplayRebasePlanIdentity}. */
  fingerprint: string;
}

/** The per-pin facts the fingerprint covers. Kept separate so #243 can build one without a plan. */
export interface ScreenplayRebaseFingerprintEntry {
  itemSourceReferenceId: string;
  screenplayRevisionId: string;
  screenplayVersion: number;
  pinUpdatedAt: string;
  source: ScreenplaySourceRange;
  sourceTextHash: string;
  recordedTextHash: string;
  classification: ScreenplayRebaseClassification;
  autoApplicable: boolean;
  proposed: ScreenplaySourceRange | null;
}

/** Everything the fingerprint is taken over. A plan satisfies this shape structurally. */
export interface ScreenplayRebaseFingerprintInput {
  planVersion: number;
  projectId: string;
  screenplayId: string;
  linkUpdatedAt: string;
  target: ScreenplayRebaseTarget;
  entries: readonly ScreenplayRebaseFingerprintEntry[];
  excluded: readonly ScreenplayRebaseExcludedReference[];
}

function fingerprintRange(range: ScreenplaySourceRange | null): string {
  return range ? `${range.start}-${range.end}` : '-';
}

function fingerprintEntryLine(entry: ScreenplayRebaseFingerprintEntry): string {
  return [
    'entry',
    entry.itemSourceReferenceId,
    entry.screenplayRevisionId,
    String(entry.screenplayVersion),
    entry.pinUpdatedAt,
    fingerprintRange(entry.source),
    entry.sourceTextHash,
    entry.recordedTextHash,
    entry.classification,
    entry.autoApplicable ? 'auto' : 'manual',
    fingerprintRange(entry.proposed),
  ].join('\t');
}

/**
 * Builds the canonical string a plan's `fingerprint` digests.
 *
 * Pure and deterministic — entries and exclusions are sorted by reference id rather than trusted in
 * presentation order — so the server that produced a plan and the server that later validates it
 * derive byte-identical input from the same facts. It returns the *string*, not the digest, because
 * this package is bundled into the browser and must not reach for a Node crypto module; the API
 * hashes it with the same SHA-256 rule the pin contract already fixes.
 *
 * Whatever appears here is what a stale plan is detected by. It deliberately covers the proposed
 * anchors as well as the inputs: if the same target text somehow yielded a different proposal, #243
 * must reject rather than apply an anchor no human ever saw.
 */
export function screenplayRebasePlanIdentity(input: ScreenplayRebaseFingerprintInput): string {
  const target = input.target;
  const lines = [
    `plan\t${String(input.planVersion)}\t${SCREENPLAY_SOURCE_OFFSET_UNIT}`,
    `project\t${input.projectId}`,
    `screenplay\t${input.screenplayId}\t${input.linkUpdatedAt}`,
    [
      'target',
      String(target.screenplayVersion),
      target.screenplayRevisionId ?? '-',
      target.sourceTextHash,
      String(target.sourceLength),
    ].join('\t'),
  ];
  for (const entry of [...input.entries].sort(byReferenceId))
    lines.push(fingerprintEntryLine(entry));
  for (const excluded of [...input.excluded].sort(byReferenceId)) {
    lines.push(`excluded\t${excluded.itemSourceReferenceId}\t${excluded.reason}`);
  }
  return lines.join('\n');
}

function byReferenceId(
  left: { itemSourceReferenceId: string },
  right: { itemSourceReferenceId: string },
): number {
  return left.itemSourceReferenceId < right.itemSourceReferenceId ? -1 : 1;
}
