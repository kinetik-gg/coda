import { describe, expect, it, vi } from 'vitest';
import {
  buildScreenplayPreview,
  screenplayBlockColumns,
  screenplayBlockSpacingBefore,
  wrapScreenplayText,
  type ScreenplayPreviewBlock,
  type ScreenplayPreviewBlockKind,
} from './screenplay-preview-model';
import { screenplayPaper } from './screenplay-paper';
import { wrapTextRanges } from './screenplay-layout-text';

function bodyPages(source: string, linesPerPage = 10) {
  return buildScreenplayPreview(source, { paperSize: 'a4', linesPerPage }).pages.filter(
    (page) => page.pageNumber !== null,
  );
}

describe('canonical screenplay layout boundary behavior', () => {
  it('preserves leading, consecutive, and trailing forced page breaks as empty pages', () => {
    const pages = bodyPages(['===', '===', 'Action.', '==='].join('\n'));

    expect(pages.map((page) => page.lines.map((line) => line.text))).toEqual([
      [],
      [],
      ['Action.'],
      [],
    ]);
  });

  it('avoids a one-line tail when splitting a long action block', () => {
    const pages = bodyPages('A'.repeat(60 * 11));

    expect(pages).toHaveLength(2);
    expect(pages[0]?.lines).toHaveLength(9);
    expect(pages[1]?.lines).toHaveLength(2);
  });

  it('keeps a heading with the first dialogue lines when the current page is nearly full', () => {
    const source = [
      'A'.repeat(60 * 6),
      '',
      'INT. ROOM - DAY',
      '',
      'BOB',
      '(quietly)',
      'Dialogue.',
    ].join('\n');
    const pages = bodyPages(source);

    expect(pages[0]?.lines.some((line) => line.kind === 'scene-heading')).toBe(false);
    expect(pages[1]?.lines.slice(0, 3).map((line) => line.kind)).toEqual([
      'scene-heading',
      'character',
      'parenthetical',
    ]);
  });

  it('keeps a heading with the first dual-dialogue rows', () => {
    const source = [
      'A'.repeat(60 * 6),
      '',
      'INT. ROOM - DAY',
      '',
      'BOB',
      'Left.',
      '',
      'ALICE^',
      'Right.',
    ].join('\n');
    const pages = bodyPages(source);

    expect(pages[0]?.lines.some((line) => line.kind === 'scene-heading')).toBe(false);
    expect(pages[1]?.lines.filter((line) => line.dualColumn).map((line) => line.text)).toEqual([
      'BOB',
      'ALICE',
      'Left.',
      'Right.',
    ]);
  });

  it('moves an indivisible short dialogue to a fresh page instead of stranding its cue', () => {
    const source = ['A'.repeat(60 * 8), '', 'BOB', '(softly)', 'Hello.'].join('\n');
    const pages = bodyPages(source);

    expect(pages[0]?.lines.every((line) => line.kind === 'action')).toBe(true);
    expect(pages[1]?.lines.map((line) => line.kind)).toEqual([
      'character',
      'parenthetical',
      'dialogue',
    ]);
  });

  it('paginates unequal dual dialogue with column-specific MORE and CONT’D cues', () => {
    const source = ['BOB', 'Short.', '', 'ALICE^', 'Right side keeps speaking. '.repeat(30)].join(
      '\n',
    );
    const pages = bodyPages(source);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.lines.filter((line) => line.continuation === 'more')).toEqual([
      expect.objectContaining({ text: '(MORE)', dualColumn: 'right' }),
    ]);
    expect(pages[1]?.lines[0]).toMatchObject({
      text: "ALICE (CONT'D)",
      dualColumn: 'right',
      continuation: 'continued',
    });
  });

  it('emits revision marks only on intersecting canonical lines', () => {
    const screenplay = 'Revised words here.';
    const metadata = {
      Revision: { Addition: [[0, 7, 5]], Removed: [], RemovalSuggestion: [] },
      'Revision Mode': true,
      'Revision Level': 5,
      'Text Length': screenplay.length,
    };
    const source = `${screenplay}\n\n/* BEAT: ${JSON.stringify(metadata)} END_BEAT */`;
    const lines = bodyPages(source)[0]?.lines ?? [];

    expect(lines[0]).toMatchObject({ text: screenplay, revisionMarker: '@@' });
  });

  it('lays contact information in the lower-left title column with source styling intact', () => {
    const source = [
      'Title: **Blue** Hour',
      'Contact: First line',
      '   Second line',
      'Draft date: Draft 1, 2026',
    ].join('\n');
    const lines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];
    const title = lines.find((line) => line.text === 'BLUE HOUR');
    const contact = lines.filter((line) => line.align === 'left');

    expect(title?.inlineStyles).toEqual([{ kind: 'bold', from: 0, to: 4 }]);
    expect(contact.map((line) => [line.text, line.baselineY])).toEqual([
      ['First line', 100.5],
      ['Second line', 88.5],
    ]);
    expect(contact.every((line) => line.textSourceOffsets?.length === line.text.length + 1)).toBe(
      true,
    );
  });

  it('wraps long title fields and preserves a Unicode expansion that changes string length', () => {
    const source = `Title: ${'A'.repeat(72)} ß`;
    const lines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];

    expect(lines).toHaveLength(2);
    expect(lines[0]?.baselineY).toBe(551.5);
    expect(lines[1]?.baselineY).toBe(539.5);
    expect(lines.at(-1)?.text.endsWith('ß')).toBe(true);
  });
});

describe('legacy screenplay model helpers', () => {
  it('returns every canonical block width and spacing family', () => {
    const paper = screenplayPaper('a4');
    const kinds: ScreenplayPreviewBlockKind[] = [
      'action',
      'centered',
      'character',
      'dialogue',
      'lyric',
      'parenthetical',
      'scene-heading',
      'title-page',
      'transition',
    ];
    const columns = kinds.map((kind) =>
      screenplayBlockColumns({ kind } as ScreenplayPreviewBlock, paper),
    );

    expect(columns).toEqual([60, 60, 38, 35, 35, 28, 55, 60, 60]);
    expect(kinds.map(screenplayBlockSpacingBefore)).toEqual([1, 1, 1, 0, 1, 0, 2, 0, 1]);
  });

  it('wraps blank paragraphs, multiple words, newlines, and overlong words deterministically', () => {
    expect(wrapScreenplayText('', 5)).toEqual(['']);
    expect(wrapScreenplayText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapScreenplayText('first\nsecond', 6)).toEqual(['first', 'second']);
    expect(wrapScreenplayText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapScreenplayText('A👩‍🚀e\u0301B', 2)).toEqual(['A👩‍🚀', 'e\u0301B']);
  });

  it('segments each adversarial paragraph once while preserving every grapheme', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    const paragraph = 'A👩‍🚀e\u0301B'.repeat(5_000);

    const lines = wrapTextRanges(`${paragraph}\n${paragraph}`, 3);

    expect(segment).toHaveBeenCalledTimes(2);
    expect(lines.map((line) => line.text).join('')).toBe(`${paragraph}${paragraph}`);
    expect(lines.every((line) => Array.from(line.text).at(-1) !== '\u200D')).toBe(true);
  });

  it('normalizes invalid column widths instead of entering a non-advancing loop', () => {
    expect(wrapTextRanges('ABC', 0).map((line) => line.text)).toEqual(['A', 'B', 'C']);
  });
});
