import { describe, expect, it } from 'vitest';
import { FOUNTAIN_SOURCE_MAX_CHARACTERS } from './index';
import {
  SCREENPLAY_SOURCE_MAX_OFFSET,
  SCREENPLAY_SOURCE_OFFSET_UNIT,
  pinSourceReferenceRevisionSchema,
  screenplaySourceRangeSchema,
  screenplaySourceTextHashSchema,
} from './breakdown-screenplay';

describe('screenplay source range', () => {
  it('names UTF-16 code units and stops at the Fountain source ceiling', () => {
    expect(SCREENPLAY_SOURCE_OFFSET_UNIT).toBe('utf16-code-unit');
    // A range must never be able to point past the longest source the product accepts.
    expect(SCREENPLAY_SOURCE_MAX_OFFSET).toBe(FOUNTAIN_SOURCE_MAX_CHARACTERS);
  });

  it('accepts a half-open range and rejects an empty or inverted one', () => {
    expect(screenplaySourceRangeSchema.parse({ start: 0, end: 1 })).toEqual({ start: 0, end: 1 });
    expect(screenplaySourceRangeSchema.safeParse({ start: 12, end: 12 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 9, end: 4 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: -1, end: 4 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 1.5, end: 4 }).success).toBe(false);
  });

  it('rejects an offset beyond the ceiling and any unknown key', () => {
    expect(
      screenplaySourceRangeSchema.safeParse({ start: 0, end: SCREENPLAY_SOURCE_MAX_OFFSET + 1 })
        .success,
    ).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 0, end: 4, unit: 'bytes' }).success).toBe(
      false,
    );
  });

  it('accepts only a lowercase hex sha256 digest', () => {
    expect(screenplaySourceTextHashSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(screenplaySourceTextHashSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(screenplaySourceTextHashSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });
});

describe('pinSourceReferenceRevisionSchema', () => {
  it('requires the mutable screenplay version the range was read from', () => {
    expect(
      pinSourceReferenceRevisionSchema.parse({
        screenplayVersion: 7,
        source: { start: 40, end: 96 },
      }),
    ).toEqual({ screenplayVersion: 7, source: { start: 40, end: 96 } });
    expect(
      pinSourceReferenceRevisionSchema.safeParse({ source: { start: 40, end: 96 } }).success,
    ).toBe(false);
    expect(
      pinSourceReferenceRevisionSchema.safeParse({
        screenplayVersion: 0,
        source: { start: 40, end: 96 },
      }).success,
    ).toBe(false);
  });

  it('rejects a revision id in the body: the server chooses the revision', () => {
    expect(
      pinSourceReferenceRevisionSchema.safeParse({
        screenplayVersion: 7,
        source: { start: 40, end: 96 },
        screenplayRevisionId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});
