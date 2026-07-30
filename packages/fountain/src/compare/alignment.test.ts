import { describe, expect, it } from 'vitest';
import {
  alignSources,
  commonPrefixLength,
  commonSuffixLength,
  placeRange,
  projectChangedRange,
} from './alignment';

describe('common affix measurement', () => {
  it.each([
    ['identical strings', 'abcdef', 'abcdef', 6],
    ['no shared start', 'abc', 'xbc', 0],
    ['shared start only', 'INT. HOUSE', 'INT. HOTEL', 7],
    ['one string is a prefix of the other', 'abc', 'abcdef', 3],
    ['empty left', '', 'abc', 0],
  ])('commonPrefixLength: %s', (_label, left, right, expected) => {
    expect(commonPrefixLength(left, right)).toBe(expected);
  });

  it('never ends a prefix between a high and a low surrogate', () => {
    // Both strings start with a high surrogate whose low surrogate differs, so the naive boundary
    // would be 1 — inside the pair.
    const left = '🎬 scene';
    const right = '🎥 scene';
    expect(commonPrefixLength(left, right)).toBe(0);
  });

  it('keeps a fully shared surrogate pair inside the prefix', () => {
    expect(commonPrefixLength('🎬A', '🎬B')).toBe(2);
  });

  it.each([
    ['identical tails', 'abcdef', 'xxcdef', 6, 4],
    ['no shared tail', 'abc', 'abx', 3, 0],
    ['clipped by the limit', 'abcdef', 'abcdef', 2, 2],
  ])('commonSuffixLength: %s', (_label, left, right, limit, expected) => {
    expect(commonSuffixLength(left, right, limit)).toBe(expected);
  });

  it('never starts a suffix between a high and a low surrogate', () => {
    const left = 'A🎬';
    const right = 'B🞬';
    // The trailing low surrogate matches but its high surrogate does not.
    expect(commonSuffixLength(left, right, 3)).toBe(0);
  });
});

describe('alignSources', () => {
  it('reports identical sources without a changed region', () => {
    const alignment = alignSources('FADE IN:', 'FADE IN:');
    expect(alignment.identical).toBe(true);
    expect(alignment.changedRegion).toBeNull();
    expect(alignment.prefixLength).toBe(8);
  });

  it('brackets a pure insertion as an empty source window', () => {
    const alignment = alignSources('abcdef', 'abcXYZdef');
    expect(alignment.identical).toBe(false);
    expect(alignment.changedRegion).toEqual({
      sourceStart: 3,
      sourceEnd: 3,
      targetStart: 3,
      targetEnd: 6,
    });
  });

  it('brackets a pure deletion as an empty target window', () => {
    expect(alignSources('abcXYZdef', 'abcdef').changedRegion).toEqual({
      sourceStart: 3,
      sourceEnd: 6,
      targetStart: 3,
      targetEnd: 3,
    });
  });

  it('brackets a replacement as two non-empty windows', () => {
    expect(alignSources('abcXYdef', 'abcQRSdef').changedRegion).toEqual({
      sourceStart: 3,
      sourceEnd: 5,
      targetStart: 3,
      targetEnd: 6,
    });
  });

  it('never lets the suffix overlap the prefix', () => {
    // "aa" -> "aaa": the naive suffix would also claim the whole string.
    const alignment = alignSources('aa', 'aaa');
    expect(alignment.prefixLength + alignment.suffixLength).toBeLessThanOrEqual(2);
  });
});

describe('placeRange', () => {
  const alignment = alignSources('0123456789', '01234XY56789');

  it('treats a range ending at the change boundary as untouched', () => {
    expect(placeRange(alignment, 0, 5)).toBe('unchanged-prefix');
  });

  it('treats a range starting at the change boundary as shifted', () => {
    expect(placeRange(alignment, 5, 10)).toBe('unchanged-suffix');
  });

  it('treats a range straddling the change as overlapping', () => {
    expect(placeRange(alignment, 3, 8)).toBe('overlaps-change');
  });

  it('treats every range as untouched when the sources are identical', () => {
    expect(placeRange(alignSources('abc', 'abc'), 1, 2)).toBe('unchanged-prefix');
  });
});

describe('projectChangedRange', () => {
  it('returns the range itself when the sources are identical', () => {
    expect(projectChangedRange(alignSources('abc', 'abc'), 1, 2)).toEqual({ start: 1, end: 2 });
  });

  it('collapses to an empty region when the range was entirely removed', () => {
    const alignment = alignSources('AAAREMOVEDBBB', 'AAABBB');
    expect(projectChangedRange(alignment, 3, 10)).toEqual({ start: 3, end: 3 });
  });

  it('keeps the surviving head of a range whose tail was removed', () => {
    const alignment = alignSources('AAA12345BBB', 'AAA12BBB');
    expect(projectChangedRange(alignment, 3, 8)).toEqual({ start: 3, end: 5 });
  });

  it('widens to cover text inserted inside the range', () => {
    const alignment = alignSources('AAA12345BBB', 'AAA12XYZ345BBB');
    expect(projectChangedRange(alignment, 3, 8)).toEqual({ start: 3, end: 11 });
  });

  it('never returns an inverted region', () => {
    const alignment = alignSources('AAAXXXBBB', 'AAABBB');
    const region = projectChangedRange(alignment, 4, 5);
    expect(region.end).toBeGreaterThanOrEqual(region.start);
  });
});
