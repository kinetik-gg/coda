import { describe, expect, it } from 'vitest';
import { scanOccurrences, searchAnchors, SearchBudget } from './search';

describe('scanOccurrences', () => {
  it('returns every ascending offset', () => {
    expect(scanOccurrences('a-b-a-b-a', 'a', 10)).toEqual({ offsets: [0, 4, 8], truncated: false });
  });

  it('counts overlapping occurrences so a repeat is never mistaken for a unique match', () => {
    expect(scanOccurrences('aaaa', 'aa', 10).offsets).toEqual([0, 1, 2]);
  });

  it('marks the scan truncated once the limit is reached with matches remaining', () => {
    const scan = scanOccurrences('aaaa', 'a', 2);
    expect(scan.offsets).toEqual([0, 1]);
    expect(scan.truncated).toBe(true);
  });

  it('does not mark a scan truncated when the limit is exactly met', () => {
    expect(scanOccurrences('ab', 'a', 1)).toEqual({ offsets: [0], truncated: false });
  });

  it.each([
    ['empty needle', 'abc', '', 5],
    ['needle longer than haystack', 'ab', 'abc', 5],
    ['zero limit', 'abc', 'b', 0],
  ])('returns nothing for %s', (_label, haystack, needle, limit) => {
    expect(scanOccurrences(haystack, needle, limit)).toEqual({ offsets: [], truncated: false });
  });
});

describe('SearchBudget', () => {
  it('counts spent passes and refuses to overspend', () => {
    const budget = new SearchBudget(2);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(false);
    expect(budget.used).toBe(2);
  });
});

describe('searchAnchors', () => {
  const widths = [4, 16, 64] as const;

  it('resolves a unique excerpt in a single pass', () => {
    const budget = new SearchBudget(8);
    const result = searchAnchors(
      { sourceText: 'aaaUNIQUEbbb', targetText: 'zzzzUNIQUEbbb', start: 3, end: 9 },
      widths,
      16,
      budget,
    );
    expect(result).toMatchObject({ offsets: [4], contextCodeUnits: 0, budgetExhausted: false });
    expect(budget.used).toBe(1);
  });

  it('escalates context to disambiguate a repeated excerpt', () => {
    // "JOHN" occurs twice in the target; only one is preceded by "LEFT ".
    const sourceText = 'LEFT JOHN talks. RIGHT JOHN listens.';
    const targetText = 'PROLOGUE. LEFT JOHN talks. RIGHT JOHN listens.';
    const budget = new SearchBudget(8);
    const result = searchAnchors({ sourceText, targetText, start: 5, end: 9 }, widths, 16, budget);
    expect(result.offsets).toEqual([15]);
    expect(result.contextCodeUnits).toBe(4);
    expect(budget.used).toBe(2);
  });

  it('stays ambiguous when no context width can separate the matches', () => {
    const sourceText = 'XX ab ab XX';
    const targetText = 'ZZ ab ab ZZ ab ab ZZ';
    const budget = new SearchBudget(16);
    const result = searchAnchors({ sourceText, targetText, start: 3, end: 5 }, widths, 16, budget);
    expect(result.offsets.length).toBeGreaterThan(1);
    expect(result.budgetExhausted).toBe(false);
  });

  it('keeps the ambiguous result when a wider context stops matching entirely', () => {
    // The excerpt "ab" repeats, but its neighbours were all rewritten, so wider context finds zero.
    const sourceText = 'QQQQab----ab----';
    const targetText = 'ab!!ab';
    const budget = new SearchBudget(8);
    const result = searchAnchors({ sourceText, targetText, start: 4, end: 6 }, widths, 16, budget);
    expect(result.offsets).toEqual([0, 4]);
    expect(result.contextCodeUnits).toBe(0);
  });

  it('reports nothing found when the excerpt is absent', () => {
    const budget = new SearchBudget(4);
    const result = searchAnchors(
      { sourceText: 'aaaGONEbbb', targetText: 'aaabbb', start: 3, end: 7 },
      widths,
      16,
      budget,
    );
    expect(result.offsets).toEqual([]);
    expect(result.budgetExhausted).toBe(false);
  });

  it('reports budget exhaustion instead of scanning', () => {
    const budget = new SearchBudget(1);
    budget.spend();
    const result = searchAnchors(
      { sourceText: 'abc', targetText: 'abc', start: 0, end: 3 },
      widths,
      16,
      budget,
    );
    expect(result).toEqual({
      offsets: [],
      truncated: false,
      contextCodeUnits: 0,
      budgetExhausted: true,
    });
  });

  it('stops escalating rather than overspending the budget', () => {
    const sourceText = 'LEFT JOHN talks. RIGHT JOHN listens.';
    const targetText = 'PROLOGUE. LEFT JOHN talks. RIGHT JOHN listens.';
    const budget = new SearchBudget(1);
    const result = searchAnchors({ sourceText, targetText, start: 5, end: 9 }, widths, 16, budget);
    expect(result.offsets.length).toBeGreaterThan(1);
    expect(result.budgetExhausted).toBe(true);
    expect(budget.used).toBe(1);
  });

  it('does not escalate when context cannot grow the needle', () => {
    // The range spans the whole source, so every width produces the same needle.
    const budget = new SearchBudget(8);
    const result = searchAnchors(
      { sourceText: 'ab', targetText: 'abab', start: 0, end: 2 },
      widths,
      16,
      budget,
    );
    expect(result.offsets).toEqual([0, 2]);
    expect(budget.used).toBe(1);
  });

  it('ignores non-positive context widths', () => {
    const budget = new SearchBudget(8);
    const result = searchAnchors(
      { sourceText: 'QQabQQ', targetText: 'ababab', start: 2, end: 4 },
      [0],
      16,
      budget,
    );
    expect(result.contextCodeUnits).toBe(0);
    expect(budget.used).toBe(1);
  });
});
