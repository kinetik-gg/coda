import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  SCREENPLAY_SOURCE_OFFSET_UNIT,
  type ResolvedSourceReferenceView,
  type ScreenplaySourceRange,
  type SourceReferenceRevisionPinView,
} from '@coda/contracts';

/**
 * Pure helpers for `item_source_revision_pins` (issue #239). Kept out of the service so the offset
 * unit, the digest, and the resolution rules can be unit-tested without a database or a Nest
 * container, and so the service stays a thin authorization/persistence shell.
 */

/** The pin row as persisted. Declared structurally so tests need no generated Prisma client. */
export interface PinRow {
  itemSourceReferenceId: string;
  screenplayId: string;
  screenplayRevisionId: string;
  screenplayVersion: number;
  sourceStart: number;
  sourceEnd: number;
  sourceTextHash: string;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReferenceRow {
  id: string;
  itemId: string;
  sourceDocumentId: string;
  startPage: number;
  endPage: number;
  position: string;
}

/**
 * Lowercase hex SHA-256 of the UTF-8 encoding of an excerpt — the algorithm named by
 * `SCREENPLAY_SOURCE_TEXT_HASH_ALGORITHM`. UTF-8 is the encoding, but the *offsets* that produced
 * the excerpt are UTF-16 code units; the two are not interchangeable and the range is sliced before
 * it is ever encoded.
 */
export function sourceTextHash(excerpt: string): string {
  return createHash('sha256').update(excerpt, 'utf8').digest('hex');
}

/**
 * Slices the pinned excerpt out of a revision's Fountain source.
 *
 * `sourceText.slice(start, end)` is the definition of the range, so this is deliberately a one-line
 * wrapper rather than a reimplementation: every producer and consumer of a range must agree that a
 * plain JavaScript string index is the unit.
 */
export function excerptOf(sourceText: string, range: ScreenplaySourceRange): string {
  return sourceText.slice(range.start, range.end);
}

/**
 * Rejects a range that does not fit the revision it is being pinned to.
 *
 * The database CHECK constraint already guarantees `0 <= start < end`; only the upper bound depends
 * on the revision, and it must be checked against `sourceText.length` — a UTF-16 code-unit count —
 * and never against `sourceByteLength`, which counts UTF-8 bytes and is larger for any non-ASCII
 * source.
 */
export function assertRangeWithinRevision(sourceText: string, range: ScreenplaySourceRange): void {
  if (range.end > sourceText.length) {
    throw new BadRequestException(
      `Source range ends at ${range.end} but the revision has ${sourceText.length} characters`,
    );
  }
}

export function pinView(row: PinRow): SourceReferenceRevisionPinView {
  return {
    itemSourceReferenceId: row.itemSourceReferenceId,
    screenplayId: row.screenplayId,
    screenplayRevisionId: row.screenplayRevisionId,
    screenplayVersion: row.screenplayVersion,
    source: { start: row.sourceStart, end: row.sourceEnd },
    sourceTextHash: row.sourceTextHash,
    sourceOffsetUnit: SCREENPLAY_SOURCE_OFFSET_UNIT,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolves one source reference into the three-state view the contract defines.
 *
 * `revisionSourceText` is the text of the revision the pin names, or `null` when that revision is
 * gone (the screenplay was purged, and no foreign key could have stopped it) or the caller may not
 * read the screenplay. In both of those cases the reference reports `unavailable` and still carries
 * its untouched `sourceDocumentId`/`startPage`/`endPage`, so it degrades to legacy PDF resolution
 * rather than becoming unreadable.
 *
 * A `null` pin is `unpinned`: the state every pre-existing reference is in, and the state #239
 * deliberately leaves them in rather than inventing a backfill.
 */
export function resolveReference(
  reference: ReferenceRow,
  pin: PinRow | null,
  revisionSourceText: string | null,
): ResolvedSourceReferenceView {
  const base = {
    id: reference.id,
    itemId: reference.itemId,
    sourceDocumentId: reference.sourceDocumentId,
    startPage: reference.startPage,
    endPage: reference.endPage,
    position: reference.position,
  };
  if (!pin) return { ...base, resolution: 'unpinned', pin: null, sourceText: null };
  const view = pinView(pin);
  if (revisionSourceText === null) {
    return { ...base, resolution: 'unavailable', pin: view, sourceText: null };
  }
  // Read from the immutable revision, never from `Screenplay.sourceText`. This single line is what
  // makes a later REST or collaborative edit unable to change what a pinned reference resolves to.
  return {
    ...base,
    resolution: 'pinned',
    pin: view,
    sourceText: excerptOf(revisionSourceText, view.source),
  };
}
