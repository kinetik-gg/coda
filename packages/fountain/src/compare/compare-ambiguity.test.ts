import { describe, expect, it } from 'vitest';
import { compareScreenplaySources } from './compare';
import { sha256HexOfUtf8 } from './sha256';
import { ScreenplayComparisonError } from './types';

/**
 * The acceptance criterion this file exists for: the engine never returns an auto-applicable shifted
 * range when more than one plausible target exists.
 */

function compareOne(
  sourceText: string,
  targetText: string,
  range: { start: number; end: number },
  options?: Parameters<typeof compareScreenplaySources>[0]['options'],
) {
  const result = compareScreenplaySources({
    sourceText,
    targetText,
    ranges: [{ id: 'ref-1', range }],
    options,
  });
  const only = result.ranges[0];
  if (only === undefined) throw new Error('expected one comparison');
  return { comparison: only, result };
}

describe('duplicated text', () => {
  it('refuses to choose between two identical candidates', () => {
    // The referenced beat now appears twice, and its surroundings were rewritten in both places, so
    // no amount of context separates them.
    const sourceText = 'HEAD\n\nA beat.\n\nTAIL';
    const targetText = 'ONE\n\nA beat.\n\nTWO\n\nA beat.\n\nTHREE';
    const { comparison } = compareOne(sourceText, targetText, { start: 6, end: 13 });

    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.reason).toBe('multiple-identical-matches');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target).toBeNull();
    expect(comparison.candidates).toHaveLength(2);
    for (const candidate of comparison.candidates) {
      expect(candidate.identicalText).toBe(true);
      expect(targetText.slice(candidate.range.start, candidate.range.end)).toBe('A beat.');
    }
  });

  it('lists candidates in ascending offset order', () => {
    const { comparison } = compareOne('QQ ab QQ', 'ab ZZ ab ZZ ab', { start: 3, end: 5 });
    const starts = comparison.candidates.map((candidate) => candidate.range.start);
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    expect(starts.length).toBeGreaterThan(1);
  });

  it('flags the candidate that sits at the original offset without preferring it', () => {
    const sourceText = 'AAA ab BBB';
    const targetText = 'ZZZ ab ab ab';
    const { comparison } = compareOne(sourceText, targetText, { start: 4, end: 6 });

    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.candidates.some((candidate) => candidate.atSourceOffset)).toBe(true);
    expect(comparison.target).toBeNull();
  });

  it('truncates a very large candidate set and says so', () => {
    const sourceText = 'HEAD ab TAIL';
    const targetText = `ZZ ${'ab '.repeat(40)}ZZ`;
    const { comparison } = compareOne(
      sourceText,
      targetText,
      { start: 5, end: 7 },
      {
        maxCandidates: 3,
      },
    );

    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.candidates).toHaveLength(3);
    expect(comparison.candidatesTruncated).toBe(true);
  });

  /**
   * A range only reaches the search path when it overlaps the changed window, which needs edits on
   * *both* sides of it — a single edit region leaves everything after it in the unchanged suffix,
   * where the affix proof resolves it without searching at all.
   */
  const REPEATED_CUE_SOURCE = [
    'INT. OPENING - DAY',
    '',
    'MAYA',
    'First line.',
    '',
    'RAJ',
    'Second line and a little more besides.',
    '',
    'MAYA',
    'Third line.',
    '',
    'The garden settles into a long quiet evening.',
    '',
    'EXT. CLOSING - NIGHT',
  ].join('\n');
  const REPEATED_CUE_TARGET = REPEATED_CUE_SOURCE.replace(
    'INT. OPENING - DAY',
    'INT. OPENING - DUSK',
  ).replace('EXT. CLOSING - NIGHT', 'EXT. CLOSING - DAWN');
  const secondCue = REPEATED_CUE_SOURCE.lastIndexOf('MAYA');

  it('resolves a repeated excerpt once its own context makes it unique', () => {
    // "MAYA" repeats all over a screenplay. The cue plus its neighbouring lines does not.
    const { comparison } = compareOne(REPEATED_CUE_SOURCE, REPEATED_CUE_TARGET, {
      start: secondCue,
      end: secondCue + 4,
    });

    // "DAY" became "DUSK" ahead of the cue, so it moved by exactly one code unit.
    expect(comparison.classification).toBe('shifted-with-identical-text');
    expect(comparison.reason).toBe('unique-identical-match-with-context');
    expect(comparison.autoApplicable).toBe(true);
    expect(comparison.target?.contextCodeUnits).toBeGreaterThan(0);
    expect(comparison.target?.shift).toBe(1);
    expect(comparison.target?.range.start).toBe(secondCue + 1);
    expect(REPEATED_CUE_TARGET.slice(secondCue + 1, secondCue + 5)).toBe('MAYA');
    expect(comparison.candidates).toHaveLength(1);
  });

  it('stays ambiguous when context disambiguation is switched off', () => {
    const { comparison } = compareOne(
      REPEATED_CUE_SOURCE,
      REPEATED_CUE_TARGET,
      { start: secondCue, end: secondCue + 4 },
      { contextWidths: [] },
    );

    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.reason).toBe('multiple-identical-matches');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.candidates).toHaveLength(2);
  });

  it('never calls a trimmed candidate set unique, even at maxCandidates of one', () => {
    const { comparison } = compareOne(
      REPEATED_CUE_SOURCE,
      REPEATED_CUE_TARGET,
      { start: secondCue, end: secondCue + 4 },
      { contextWidths: [], maxCandidates: 1 },
    );

    expect(comparison.candidates).toHaveLength(1);
    expect(comparison.candidatesTruncated).toBe(true);
    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target).toBeNull();
  });

  it('stays ambiguous when the neighbours on both sides of a repeated excerpt also changed', () => {
    // Context can only disambiguate using text that still exists. When a repeated excerpt is hemmed
    // in by edits on both sides, every context width finds nothing and the engine keeps the honest
    // ambiguous answer rather than falling back to the nearest plausible offset.
    const sourceText = 'HEAD\n\nMAYA\nFirst.\n\nRAJ\nSecond.\n\nMAYA\nThird.\n\nTAIL';
    const targetText = sourceText.replace('HEAD', 'HEADER').replace('TAIL', 'TAILPIECE');
    const cue = sourceText.lastIndexOf('MAYA');
    const { comparison } = compareOne(sourceText, targetText, { start: cue, end: cue + 4 });

    expect(comparison.classification).toBe('ambiguous');
    expect(comparison.reason).toBe('multiple-identical-matches');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target).toBeNull();
    expect(comparison.candidates.length).toBeGreaterThan(1);
    // Every reported candidate is a real occurrence, so the reviewer picks from facts.
    for (const candidate of comparison.candidates) {
      expect(targetText.slice(candidate.range.start, candidate.range.end)).toBe('MAYA');
    }
  });
});

describe('contradictory evidence', () => {
  it('refuses to re-anchor when the recorded hash disagrees with the old source', () => {
    const sourceText = 'INT. KITCHEN - DAY\n\nA beat.';
    const comparison = compareScreenplaySources({
      sourceText,
      targetText: sourceText,
      ranges: [{ id: 'ref-1', range: { start: 0, end: 18 }, recordedTextHash: 'f'.repeat(64) }],
    }).ranges[0];

    expect(comparison?.classification).toBe('ambiguous');
    expect(comparison?.reason).toBe('recorded-hash-mismatch');
    expect(comparison?.autoApplicable).toBe(false);
    expect(comparison?.target).toBeNull();
    expect(comparison?.candidates).toEqual([]);
    expect(comparison?.source.recordedTextHashMatches).toBe(false);
    expect(comparison?.source.textHash).toBe(sha256HexOfUtf8('INT. KITCHEN - DAY'));
  });

  it('checks the hash before anything else, even for identical sources', () => {
    const result = compareScreenplaySources({
      sourceText: 'abcdef',
      targetText: 'abcdef',
      ranges: [{ id: 'ref-1', range: { start: 0, end: 3 }, recordedTextHash: '0'.repeat(64) }],
    });
    expect(result.ranges[0]?.reason).toBe('recorded-hash-mismatch');
    expect(result.budget.searchPassesUsed).toBe(0);
  });
});

describe('bounded work', () => {
  it('spends no passes when every range sits outside the changed region', () => {
    const sourceText = `${'A'.repeat(500)}MIDDLE${'B'.repeat(500)}`;
    const targetText = `${'A'.repeat(500)}CHANGED${'B'.repeat(500)}`;
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [
        { id: 'before', range: { start: 0, end: 100 } },
        { id: 'after', range: { start: 520, end: 620 } },
      ],
    });

    expect(result.budget.searchPassesUsed).toBe(0);
    expect(result.budget.exhausted).toBe(false);
    expect(result.ranges.map((range) => range.classification)).toEqual([
      'unchanged',
      'shifted-with-identical-text',
    ]);
  });

  it('reports budget exhaustion as ambiguous rather than guessing', () => {
    const sourceText = 'AAA one BBB two CCC';
    const targetText = 'ZZZ one ZZZ two ZZZ';
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [
        { id: 'first', range: { start: 4, end: 7 } },
        { id: 'second', range: { start: 12, end: 15 } },
      ],
      options: { maxSearchPasses: 1 },
    });

    expect(result.budget.maxSearchPasses).toBe(1);
    expect(result.budget.searchPassesUsed).toBe(1);
    expect(result.budget.exhausted).toBe(true);
    expect(result.ranges[1]?.classification).toBe('ambiguous');
    expect(result.ranges[1]?.reason).toBe('search-budget-exhausted');
    expect(result.ranges[1]?.autoApplicable).toBe(false);
    expect(result.ranges[1]?.candidates).toEqual([]);
  });
});

describe('rejected input', () => {
  const sourceText = 'abcdef';

  it.each([
    ['empty range', { start: 2, end: 2 }, 'empty-range'],
    ['inverted range', { start: 4, end: 2 }, 'empty-range'],
    ['negative start', { start: -1, end: 2 }, 'range-out-of-bounds'],
    ['end past the source', { start: 0, end: 99 }, 'range-out-of-bounds'],
    ['fractional offsets', { start: 0.5, end: 2 }, 'non-integer-range'],
  ])('throws for a %s', (_label, range, code) => {
    try {
      compareScreenplaySources({
        sourceText,
        targetText: sourceText,
        ranges: [{ id: 'x', range }],
      });
      expect.unreachable('expected a ScreenplayComparisonError');
    } catch (error) {
      expect(error).toBeInstanceOf(ScreenplayComparisonError);
      expect((error as ScreenplayComparisonError).code).toBe(code);
      expect((error as ScreenplayComparisonError).rangeId).toBe('x');
    }
  });

  it('throws for a duplicate range id', () => {
    expect(() =>
      compareScreenplaySources({
        sourceText,
        targetText: sourceText,
        ranges: [
          { id: 'same', range: { start: 0, end: 1 } },
          { id: 'same', range: { start: 1, end: 2 } },
        ],
      }),
    ).toThrow(/duplicate range id same/);
  });

  it.each([
    ['maxSearchPasses', { maxSearchPasses: 0 }],
    ['maxCandidates', { maxCandidates: -1 }],
    ['a fractional context width', { contextWidths: [1.5] }],
    ['descending context widths', { contextWidths: [64, 16] }],
  ])('throws for an invalid option: %s', (_label, options) => {
    try {
      compareScreenplaySources({ sourceText, targetText: sourceText, ranges: [], options });
      expect.unreachable('expected a ScreenplayComparisonError');
    } catch (error) {
      expect((error as ScreenplayComparisonError).code).toBe('invalid-option');
      expect((error as ScreenplayComparisonError).rangeId).toBeNull();
    }
  });

  it('throws when either source exceeds the contract ceiling', () => {
    const tooLong = 'a'.repeat(5_000_001);
    expect(() =>
      compareScreenplaySources({ sourceText: tooLong, targetText: 'a', ranges: [] }),
    ).toThrow(/source exceeds/);
    expect(() =>
      compareScreenplaySources({ sourceText: 'a', targetText: tooLong, ranges: [] }),
    ).toThrow(/source exceeds/);
  });

  it('accepts a source exactly at the ceiling', () => {
    const atLimit = 'a'.repeat(5_000_000);
    const result = compareScreenplaySources({
      sourceText: atLimit,
      targetText: atLimit,
      ranges: [{ id: 'x', range: { start: 0, end: 1 } }],
    });
    expect(result.ranges[0]?.classification).toBe('unchanged');
  });
});
