import { z } from 'zod';

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
