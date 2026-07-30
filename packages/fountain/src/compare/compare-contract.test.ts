import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareScreenplaySources } from './compare';
import {
  FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH,
  FOUNTAIN_COMPARE_OFFSET_UNIT,
  type ScreenplayComparisonReason,
  type ScreenplayRangeClassification,
} from './types';

/**
 * `packages/fountain` has no workspace dependency on `@coda/contracts` — it is a leaf package that
 * `apps/web` bundles — so the two mirrored constants cannot be compared by import. They are compared
 * by reading the contract module off disk instead, which makes this a real drift gate rather than a
 * restatement of the same literal in two places.
 */
const CONTRACT_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'contracts',
  'src',
  'breakdown-screenplay.ts',
);

function contractSource(): string {
  return readFileSync(CONTRACT_PATH, 'utf8');
}

describe('agreement with the screenplay source-range contract', () => {
  it('mirrors SCREENPLAY_SOURCE_OFFSET_UNIT', () => {
    const match = /SCREENPLAY_SOURCE_OFFSET_UNIT = '([^']+)'/.exec(contractSource());
    expect(match?.[1]).toBe(FOUNTAIN_COMPARE_OFFSET_UNIT);
  });

  it('mirrors SCREENPLAY_SOURCE_MAX_OFFSET', () => {
    const match = /SCREENPLAY_SOURCE_MAX_OFFSET = ([0-9_]+)/.exec(contractSource());
    expect(Number((match?.[1] ?? '').replaceAll('_', ''))).toBe(FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH);
  });

  it('treats offsets as UTF-16 code units, not bytes or characters', () => {
    // "🎬" is one code point but two code units, and four UTF-8 bytes. A range of [0, 2) must mean
    // the whole emoji, which is what a plain `slice` does and what the contract requires.
    const sourceText = '🎬 ACTION';
    const result = compareScreenplaySources({
      sourceText,
      targetText: sourceText,
      ranges: [{ id: 'emoji', range: { start: 0, end: 2 } }],
    });
    expect(result.ranges[0]?.source.text).toBe('🎬');
    expect(result.offsetUnit).toBe('utf16-code-unit');
  });

  it('applies no normalisation, folding, or line-ending rewriting', () => {
    // Same visible text, CRLF versus LF, plus a decomposed versus precomposed accent. Both must read
    // as real differences, never quietly reconciled.
    const sourceText = 'CAFÉ\r\nDAY';
    const targetText = 'CAFÉ\nDAY';
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [{ id: 'accent', range: { start: 0, end: 4 } }],
    });
    expect(result.identicalSources).toBe(false);
    expect(result.ranges[0]?.classification).not.toBe('unchanged');
  });

  it('only ever produces the five contract classifications', () => {
    const allowed: readonly ScreenplayRangeClassification[] = [
      'unchanged',
      'shifted-with-identical-text',
      'materially-changed',
      'deleted',
      'ambiguous',
    ];
    const sourceText = 'AAA one BBB two CCC three DDD';
    const targetText = 'AAA one ZZZ four CCC three DDD ab ab';
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [
        { id: 'a', range: { start: 0, end: 7 } },
        { id: 'b', range: { start: 8, end: 15 } },
        { id: 'c', range: { start: 16, end: 29 } },
        { id: 'd', range: { start: 12, end: 15 } },
      ],
    });
    for (const range of result.ranges) {
      expect(allowed).toContain(range.classification);
    }
  });

  it('never marks anything but a proven identical anchor auto-applicable', () => {
    const autoApplicableReasons: readonly ScreenplayComparisonReason[] = [
      'identical-source-text',
      'inside-unchanged-prefix',
      'inside-unchanged-suffix',
      'unique-identical-match',
      'unique-identical-match-with-context',
    ];
    const sourceText = 'HEAD alpha MID beta TAIL beta';
    const targetText = 'PRE HEAD alpha MID gamma TAIL beta beta';
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [
        { id: 'alpha', range: { start: 5, end: 10 } },
        { id: 'beta-one', range: { start: 15, end: 19 } },
        { id: 'beta-two', range: { start: 25, end: 29 } },
        { id: 'tail', range: { start: 20, end: 24 } },
      ],
    });

    for (const range of result.ranges) {
      if (!range.autoApplicable) continue;
      expect(['unchanged', 'shifted-with-identical-text']).toContain(range.classification);
      expect(autoApplicableReasons).toContain(range.reason);
      expect(range.candidates).toHaveLength(1);
      expect(range.target).not.toBeNull();
      expect(range.target?.identicalText).toBe(true);
      expect(range.target?.text).toBe(range.source.text);
      expect(targetText.slice(range.target?.range.start, range.target?.range.end)).toBe(
        range.source.text,
      );
    }
  });

  it('never proposes an empty or out-of-bounds target range', () => {
    const sourceText = 'AAA removed BBB kept CCC';
    const targetText = 'AAA BBB kept CCC extra';
    const result = compareScreenplaySources({
      sourceText,
      targetText,
      ranges: [
        { id: 'gone', range: { start: 4, end: 12 } },
        { id: 'kept', range: { start: 16, end: 20 } },
        { id: 'straddle', range: { start: 2, end: 14 } },
      ],
    });

    for (const range of result.ranges) {
      for (const candidate of [...range.candidates, range.target].filter(
        (value) => value !== null && value !== undefined,
      )) {
        expect(candidate.range.start).toBeGreaterThanOrEqual(0);
        expect(candidate.range.end).toBeGreaterThan(candidate.range.start);
        expect(candidate.range.end).toBeLessThanOrEqual(targetText.length);
      }
    }
  });
});

describe('determinism', () => {
  const sourceText = [
    'INT. OFFICE - DAY',
    '',
    'A phone rings twice.',
    '',
    'MAYA',
    'Not again.',
    '',
    'INT. OFFICE - NIGHT',
    '',
    'A phone rings twice.',
    '',
    'MAYA',
    'Not again.',
  ].join('\n');
  const targetText = sourceText
    .replace('A phone rings twice.', 'A phone rings three times.')
    .concat('\n\nFADE OUT.');
  const ranges = [
    { id: 'heading', range: { start: 0, end: 17 } },
    { id: 'first-action', range: { start: 19, end: 39 } },
    { id: 'first-cue', range: { start: 41, end: 45 } },
    {
      id: 'second-cue',
      range: { start: sourceText.lastIndexOf('MAYA'), end: sourceText.lastIndexOf('MAYA') + 4 },
    },
  ];

  it('produces a byte-for-byte identical result for identical inputs', () => {
    const first = compareScreenplaySources({ sourceText, targetText, ranges });
    const second = compareScreenplaySources({ sourceText, targetText, ranges });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on how many times the engine has already run', () => {
    const baseline = JSON.stringify(compareScreenplaySources({ sourceText, targetText, ranges }));
    for (let iteration = 0; iteration < 5; iteration += 1) {
      compareScreenplaySources({ sourceText: 'noise', targetText: 'other noise', ranges: [] });
    }
    expect(JSON.stringify(compareScreenplaySources({ sourceText, targetText, ranges }))).toBe(
      baseline,
    );
  });

  it('echoes range ids in the order they were given', () => {
    const result = compareScreenplaySources({ sourceText, targetText, ranges });
    expect(result.ranges.map((range) => range.id)).toEqual(ranges.map((range) => range.id));
  });

  it('does not mutate the request', () => {
    const request = { sourceText, targetText, ranges };
    const snapshot = JSON.stringify(request);
    compareScreenplaySources(request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});
