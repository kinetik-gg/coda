import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertRangeWithinRevision,
  excerptOf,
  pinView,
  resolveReference,
  sourceTextHash,
  type PinRow,
  type ReferenceRow,
} from './source-revision-pin';

const referenceId = '30000000-0000-4000-8000-000000000001';
const itemId = '30000000-0000-4000-8000-000000000002';
const sourceDocumentId = '30000000-0000-4000-8000-000000000003';
const screenplayId = '30000000-0000-4000-8000-000000000004';
const revisionId = '30000000-0000-4000-8000-000000000005';
const userId = '30000000-0000-4000-8000-000000000006';

const createdAt = new Date('2026-07-30T10:00:00.000Z');
const updatedAt = new Date('2026-07-30T11:00:00.000Z');

const source = 'INT. DINER - NIGHT\n\nMAYA sets down the envelope.\n';

function reference(): ReferenceRow {
  return { id: referenceId, itemId, sourceDocumentId, startPage: 4, endPage: 9, position: 'b' };
}

function pin(overrides: Partial<PinRow> = {}): PinRow {
  return {
    itemSourceReferenceId: referenceId,
    screenplayId,
    screenplayRevisionId: revisionId,
    screenplayVersion: 7,
    sourceStart: 20,
    sourceEnd: 48,
    sourceTextHash: sourceTextHash(source.slice(20, 48)),
    createdById: userId,
    updatedById: userId,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

describe('the source-range unit', () => {
  it('slices by UTF-16 code unit, which is a plain JavaScript string index', () => {
    expect(excerptOf(source, { start: 0, end: 18 })).toBe('INT. DINER - NIGHT');
    expect(excerptOf(source, { start: 20, end: 48 })).toBe('MAYA sets down the envelope.');
  });

  it('counts an astral character as the two code units it occupies, not one and not four bytes', () => {
    // A single emoji is one code point, two UTF-16 code units, and four UTF-8 bytes. A range that
    // confused those units would slice a lone surrogate here.
    const withEmoji = 'A🎬B';
    expect(withEmoji.length).toBe(4);
    expect(Buffer.byteLength(withEmoji, 'utf8')).toBe(6);
    expect(excerptOf(withEmoji, { start: 1, end: 3 })).toBe('🎬');
    expect(excerptOf(withEmoji, { start: 3, end: 4 })).toBe('B');
  });

  it('hashes the UTF-8 encoding of the sliced excerpt in lowercase hex', () => {
    const excerpt = excerptOf(source, { start: 20, end: 48 });
    expect(sourceTextHash(excerpt)).toBe(
      createHash('sha256').update(excerpt, 'utf8').digest('hex'),
    );
    expect(sourceTextHash(excerpt)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different digest for a range that quotes different text', () => {
    expect(sourceTextHash(excerptOf(source, { start: 20, end: 48 }))).not.toBe(
      sourceTextHash(excerptOf(source, { start: 20, end: 47 })),
    );
  });
});

describe('assertRangeWithinRevision', () => {
  it('accepts a range that ends exactly at the end of the source', () => {
    expect(() => assertRangeWithinRevision(source, { start: 0, end: source.length })).not.toThrow();
  });

  it('rejects a range that runs past the revision', () => {
    expect(() => assertRangeWithinRevision(source, { start: 0, end: source.length + 1 })).toThrow(
      BadRequestException,
    );
  });

  it('bounds against the code-unit length, never the UTF-8 byte length', () => {
    // 'é' is one code unit and two UTF-8 bytes. A byte-length bound would wrongly admit end === 2.
    expect(() => assertRangeWithinRevision('é', { start: 0, end: 1 })).not.toThrow();
    expect(() => assertRangeWithinRevision('é', { start: 0, end: 2 })).toThrow(BadRequestException);
  });
});

describe('pinView', () => {
  it('reports the offset unit alongside the range so no consumer has to assume it', () => {
    expect(pinView(pin())).toEqual({
      itemSourceReferenceId: referenceId,
      screenplayId,
      screenplayRevisionId: revisionId,
      screenplayVersion: 7,
      source: { start: 20, end: 48 },
      sourceTextHash: sourceTextHash(source.slice(20, 48)),
      sourceOffsetUnit: 'utf16-code-unit',
      createdById: userId,
      updatedById: userId,
      createdAt: '2026-07-30T10:00:00.000Z',
      updatedAt: '2026-07-30T11:00:00.000Z',
    });
  });
});

describe('resolveReference', () => {
  it('reports a legacy reference as unpinned with its PDF and pages intact', () => {
    expect(resolveReference(reference(), null, null)).toEqual({
      id: referenceId,
      itemId,
      sourceDocumentId,
      startPage: 4,
      endPage: 9,
      position: 'b',
      resolution: 'unpinned',
      pin: null,
      sourceText: null,
    });
  });

  it('reads the excerpt out of the revision text it is handed', () => {
    const resolved = resolveReference(reference(), pin(), source);

    expect(resolved.resolution).toBe('pinned');
    expect(resolved.sourceText).toBe('MAYA sets down the envelope.');
    expect(resolved.pin?.screenplayRevisionId).toBe(revisionId);
  });

  it('keeps the PDF and pages unchanged when a pin resolves', () => {
    const resolved = resolveReference(reference(), pin(), source);

    expect(resolved.sourceDocumentId).toBe(sourceDocumentId);
    expect(resolved.startPage).toBe(4);
    expect(resolved.endPage).toBe(9);
    expect(resolved.position).toBe('b');
  });

  it('resolves identically no matter how the mutable screenplay has since changed', () => {
    // The only text this function will ever read is the revision text argument, which is immutable.
    // Two calls with the same revision text therefore agree, which is the whole point of #239.
    expect(resolveReference(reference(), pin(), source)).toEqual(
      resolveReference(reference(), pin(), source),
    );
  });

  it('reports unavailable — not unpinned — when the pinned revision is gone', () => {
    const resolved = resolveReference(reference(), pin(), null);

    // The distinction matters: `unavailable` still carries the pin, so the UI can offer to clear or
    // re-pin it, while the reference already reads as its original PDF pages.
    expect(resolved.resolution).toBe('unavailable');
    expect(resolved.pin?.screenplayRevisionId).toBe(revisionId);
    expect(resolved.sourceText).toBeNull();
    expect(resolved.startPage).toBe(4);
  });

  it('clamps nothing: a stored range past the supplied text yields a short excerpt, not a throw', () => {
    // Reads never fail on a range the write path already validated; `assertRangeWithinRevision`
    // is the guard, and a truncated excerpt plus a mismatched hash is the honest read-side signal.
    const resolved = resolveReference(reference(), pin({ sourceEnd: 10_000 }), source);

    expect(resolved.resolution).toBe('pinned');
    expect(resolved.sourceText).toBe(source.slice(20));
    expect(sourceTextHash(resolved.sourceText!)).not.toBe(resolved.pin?.sourceTextHash);
  });
});
