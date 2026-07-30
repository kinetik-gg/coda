import { describe, expect, it } from 'vitest';
import { compareScreenplaySources } from './compare';
import { sha256HexOfUtf8 } from './sha256';
import type { ScreenplayRangeComparison } from './types';

/**
 * The structural edit cases: insertions before, inside and after a range, deletions overlapping a
 * boundary, whole-range deletion, a pure move, and the adjacent-range boundary the half-open interval
 * exists to make expressible.
 */

const SCRIPT = [
  'INT. KITCHEN - MORNING',
  '',
  'MAYA cracks an egg into a bowl.',
  '',
  'MAYA',
  'One more and it is breakfast.',
  '',
  'EXT. GARDEN - LATER',
  '',
  'RAJ prunes the roses with unnecessary force.',
  '',
].join('\n');

function offsetOf(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`fixture is missing ${needle}`);
  return index;
}

function rangeOf(text: string, needle: string): { start: number; end: number } {
  const start = offsetOf(text, needle);
  return { start, end: start + needle.length };
}

function compareOne(
  sourceText: string,
  targetText: string,
  range: { start: number; end: number },
): ScreenplayRangeComparison {
  const result = compareScreenplaySources({
    sourceText,
    targetText,
    ranges: [{ id: 'ref-1', range }],
  });
  const only = result.ranges[0];
  if (only === undefined) throw new Error('expected one comparison');
  return only;
}

describe('unchanged sources', () => {
  it('classifies every range unchanged with no searching at all', () => {
    const result = compareScreenplaySources({
      sourceText: SCRIPT,
      targetText: SCRIPT,
      ranges: [
        { id: 'a', range: rangeOf(SCRIPT, 'INT. KITCHEN - MORNING') },
        { id: 'b', range: rangeOf(SCRIPT, 'RAJ prunes the roses with unnecessary force.') },
      ],
    });

    expect(result.identicalSources).toBe(true);
    expect(result.changedRegion).toBeNull();
    expect(result.budget.searchPassesUsed).toBe(0);
    for (const range of result.ranges) {
      expect(range.classification).toBe('unchanged');
      expect(range.reason).toBe('identical-source-text');
      expect(range.autoApplicable).toBe(true);
      expect(range.target?.shift).toBe(0);
      expect(range.target?.identicalText).toBe(true);
    }
  });

  it('reports the offset unit and both source lengths', () => {
    const result = compareScreenplaySources({ sourceText: 'a', targetText: 'a', ranges: [] });
    expect(result.offsetUnit).toBe('utf16-code-unit');
    expect(result.sourceLength).toBe(1);
    expect(result.targetLength).toBe(1);
  });
});

describe('insertions', () => {
  it('leaves a range before the insertion at the same offsets', () => {
    const range = rangeOf(SCRIPT, 'INT. KITCHEN - MORNING');
    const insertAt = offsetOf(SCRIPT, 'EXT. GARDEN');
    const target = `${SCRIPT.slice(0, insertAt)}INT. HALLWAY - DAY\n\nA door closes.\n\n${SCRIPT.slice(insertAt)}`;
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('unchanged');
    expect(comparison.reason).toBe('inside-unchanged-prefix');
    expect(comparison.autoApplicable).toBe(true);
    expect(comparison.target?.range).toEqual(range);
  });

  it('shifts a range after the insertion by exactly the inserted length', () => {
    const range = rangeOf(SCRIPT, 'RAJ prunes the roses with unnecessary force.');
    const insertion = 'MAYA wipes her hands.\n\n';
    const insertAt = offsetOf(SCRIPT, 'EXT. GARDEN');
    const target = `${SCRIPT.slice(0, insertAt)}${insertion}${SCRIPT.slice(insertAt)}`;
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('shifted-with-identical-text');
    expect(comparison.reason).toBe('inside-unchanged-suffix');
    expect(comparison.autoApplicable).toBe(true);
    expect(comparison.target?.shift).toBe(insertion.length);
    expect(comparison.target?.identicalText).toBe(true);
    expect(comparison.target?.text).toBe(comparison.source.text);
  });

  it('materially changes a range with text inserted inside it', () => {
    const range = rangeOf(SCRIPT, 'MAYA cracks an egg into a bowl.');
    const splitAt = offsetOf(SCRIPT, 'an egg');
    const target = `${SCRIPT.slice(0, splitAt)}two eggs and then ${SCRIPT.slice(splitAt)}`;
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('materially-changed');
    expect(comparison.reason).toBe('replacement-region');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target?.identicalText).toBe(false);
    expect(comparison.target?.text).toContain('two eggs and then an egg');
  });
});

describe('deletions', () => {
  it('reports a wholly removed range as deleted with no candidate', () => {
    const line = 'RAJ prunes the roses with unnecessary force.';
    const range = rangeOf(SCRIPT, line);
    const target = SCRIPT.replace(line, '');
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('deleted');
    expect(comparison.reason).toBe('replacement-region-empty');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target).toBeNull();
    expect(comparison.candidates).toEqual([]);
  });

  it('reports a range whose tail was deleted as materially changed', () => {
    const range = rangeOf(SCRIPT, 'MAYA cracks an egg into a bowl.');
    const target = SCRIPT.replace('an egg into a bowl.', 'an egg.');
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('materially-changed');
    expect(comparison.autoApplicable).toBe(false);
    expect(comparison.target?.text).toBe('MAYA cracks an egg.');
  });

  it('reports a deletion straddling the start boundary as materially changed', () => {
    const range = rangeOf(SCRIPT, 'EXT. GARDEN - LATER');
    const target = SCRIPT.replace('breakfast.\n\nEXT. GARDEN', 'breakfast.\n\nGARDEN');
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('materially-changed');
    expect(comparison.target?.text).toBe('GARDEN - LATER');
  });
});

describe('moves', () => {
  it('re-anchors a block moved elsewhere in the script', () => {
    const block = 'EXT. GARDEN - LATER\n\nRAJ prunes the roses with unnecessary force.\n';
    const range = rangeOf(SCRIPT, 'RAJ prunes the roses with unnecessary force.');
    const withoutBlock = SCRIPT.replace(block, '');
    const target = `FADE IN:\n\n${block}\n${withoutBlock}`;
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('shifted-with-identical-text');
    expect(comparison.reason).toBe('unique-identical-match');
    expect(comparison.autoApplicable).toBe(true);
    expect(comparison.target?.text).toBe(comparison.source.text);
    expect(target.slice(comparison.target?.range.start, comparison.target?.range.end)).toBe(
      comparison.source.text,
    );
  });

  it('reports unchanged when a length-preserving edit leaves the range where it was', () => {
    const range = rangeOf(SCRIPT, 'RAJ prunes the roses with unnecessary force.');
    const target = SCRIPT.replace('MORNING', 'EVENING');
    const comparison = compareOne(SCRIPT, target, range);

    expect(comparison.classification).toBe('unchanged');
    expect(comparison.reason).toBe('inside-unchanged-suffix');
    expect(comparison.target?.shift).toBe(0);
    expect(comparison.autoApplicable).toBe(true);
  });
});

describe('the adjacent-range boundary', () => {
  const left = 'MAYA\nOne more and it is breakfast.';
  const rightStart = offsetOf(SCRIPT, 'EXT. GARDEN - LATER');

  it('splits two ranges sharing one boundary offset across an insertion at that offset', () => {
    const leftRange = { start: offsetOf(SCRIPT, left), end: rightStart };
    const rightRange = { start: rightStart, end: SCRIPT.length };
    const insertion = 'INT. HALLWAY - DAY\n\nA door closes.\n\n';
    const target = `${SCRIPT.slice(0, rightStart)}${insertion}${SCRIPT.slice(rightStart)}`;

    const result = compareScreenplaySources({
      sourceText: SCRIPT,
      targetText: target,
      ranges: [
        { id: 'left', range: leftRange },
        { id: 'right', range: rightRange },
      ],
    });

    const [before, after] = result.ranges;
    expect(before?.id).toBe('left');
    expect(before?.classification).toBe('unchanged');
    expect(before?.reason).toBe('inside-unchanged-prefix');
    expect(before?.target?.range).toEqual(leftRange);

    expect(after?.id).toBe('right');
    expect(after?.classification).toBe('shifted-with-identical-text');
    expect(after?.reason).toBe('inside-unchanged-suffix');
    expect(after?.target?.shift).toBe(insertion.length);

    // Neither needed a search: the shared boundary is resolved by the affix proof alone.
    expect(result.budget.searchPassesUsed).toBe(0);

    // This is exactly what the half-open interval exists to express. In the old source the two
    // ranges met at one offset; in the new source that single boundary has split in two, and the gap
    // between them is precisely the inserted text. Neither range absorbed the insertion, and the
    // insertion did not land ambiguously "in" either of them.
    expect(before?.target?.range.end).toBe(rightStart);
    expect(after?.target?.range.start).toBe(rightStart + insertion.length);
    expect((after?.target?.range.start ?? 0) - (before?.target?.range.end ?? 0)).toBe(
      insertion.length,
    );
    expect(target.slice(rightStart, rightStart + insertion.length)).toBe(insertion);
  });
});

describe('source evidence', () => {
  it('reports the excerpt and its contract hash', () => {
    const range = rangeOf(SCRIPT, 'EXT. GARDEN - LATER');
    const comparison = compareOne(SCRIPT, SCRIPT, range);

    expect(comparison.source.range).toEqual(range);
    expect(comparison.source.text).toBe('EXT. GARDEN - LATER');
    expect(comparison.source.textHash).toBe(sha256HexOfUtf8('EXT. GARDEN - LATER'));
    expect(comparison.source.recordedTextHash).toBeNull();
    expect(comparison.source.recordedTextHashMatches).toBeNull();
  });

  it('confirms a recorded hash that agrees with the old source', () => {
    const range = rangeOf(SCRIPT, 'EXT. GARDEN - LATER');
    const comparison = compareScreenplaySources({
      sourceText: SCRIPT,
      targetText: SCRIPT,
      ranges: [{ id: 'ref-1', range, recordedTextHash: sha256HexOfUtf8('EXT. GARDEN - LATER') }],
    }).ranges[0];

    expect(comparison?.source.recordedTextHashMatches).toBe(true);
    expect(comparison?.classification).toBe('unchanged');
  });

  it('hashes every candidate it reports', () => {
    const range = rangeOf(SCRIPT, 'MAYA cracks an egg into a bowl.');
    const target = SCRIPT.replace('an egg into a bowl.', 'an egg.');
    const comparison = compareOne(SCRIPT, target, range);

    for (const candidate of comparison.candidates) {
      expect(candidate.textHash).toBe(sha256HexOfUtf8(candidate.text));
      expect(candidate.range.end).toBeGreaterThan(candidate.range.start);
      expect(candidate.range.end).toBeLessThanOrEqual(target.length);
    }
  });
});
