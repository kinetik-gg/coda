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
import { lineFont, wrapTextRanges } from './screenplay-layout-text';

function bodyPages(source: string, linesPerPage = 10) {
  return buildScreenplayPreview(source, { paperSize: 'a4', linesPerPage }).pages.filter(
    (page) => page.pageNumber !== null,
  );
}

describe('canonical screenplay layout boundary behavior', () => {
  it('uses the canonical typefaces for headings, cues, dialogue, and lyrics', () => {
    expect(lineFont('scene-heading')).toBe('bold');
    expect(lineFont('character')).toBe('regular');
    expect(lineFont('dialogue')).toBe('regular');
    expect(lineFont('lyric')).toBe('italic');
  });

  it('preserves leading, consecutive, and trailing forced page breaks as empty pages', () => {
    const pages = bodyPages(['===', '===', 'Action.', '==='].join('\n'));

    expect(pages.map((page) => page.lines.map((line) => line.text))).toEqual([
      [],
      [],
      ['Action.'],
      [],
    ]);
  });

  it('collapses repeated separators to the structural spacing minimum', () => {
    const oneBlank = bodyPages(['First.', '', 'Second.'].join('\n'))[0]?.lines ?? [];
    const threeBlanks = bodyPages(['First.', '', '', '', 'Second.'].join('\n'))[0]?.lines ?? [];

    expect(oneBlank.map((line) => line.text)).toEqual(['First.', 'Second.']);
    expect((oneBlank[0]?.baselineY ?? 0) - (oneBlank[1]?.baselineY ?? 0)).toBe(24);
    expect(threeBlanks.map((line) => line.text)).toEqual(['First.', 'Second.']);
    expect((threeBlanks[0]?.baselineY ?? 0) - (threeBlanks.at(-1)?.baselineY ?? 0)).toBe(24);
  });

  it('ignores leading and trailing separator rows', () => {
    const lines = bodyPages('\n\nFirst.\n\n\n')[0]?.lines ?? [];

    expect(lines.map((line) => line.text)).toEqual(['First.']);
    expect(lines.map((line) => line.baselineY)).toEqual([769]);
    expect(lines.map((line) => [line.sourceStart, line.sourceEnd])).toEqual([[2, 8]]);
  });

  it('uses separator run length across non-Action tokens without crossing metadata barriers', () => {
    const direct =
      bodyPages(['INT. ROOM - DAY', '', '', '', 'BOB', 'Hello.'].join('\n'))[0]?.lines ?? [];
    const barrier =
      bodyPages(['First.', '', '', '', '[[private]]', '', '', '', 'Second.'].join('\n'))[0]
        ?.lines ?? [];
    const heading = direct.find((line) => line.kind === 'scene-heading');
    const cue = direct.find((line) => line.kind === 'character' && line.text === 'BOB');

    expect((heading?.baselineY ?? 0) - (cue?.baselineY ?? 0)).toBe(24);
    expect(direct.filter((line) => line.text === '')).toHaveLength(0);
    expect(barrier.map((line) => line.text)).toEqual(['First.', 'Second.']);
    expect((barrier[0]?.baselineY ?? 0) - (barrier[1]?.baselineY ?? 0)).toBe(24);
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

  it.each([
    ['section', '# Act Two'],
    ['synopsis', '=The story turns'],
    ['note', '[[A private note]]'],
    ['boneyard', '/* A removed passage */'],
  ])('does not pair dual dialogue across a %s barrier', (_kind, barrier) => {
    const source = ['BOB', 'Left.', '', barrier, '', 'ALICE^', 'Right.'].join('\n');
    const lines = bodyPages(source)[0]?.lines ?? [];

    expect(lines.filter((line) => line.dualColumn)).toEqual([]);
    expect(lines.map((line) => line.text)).toEqual(['BOB', 'Left.', 'ALICE', 'Right.']);
  });

  it('uses the final row for a cue and continues its follower block on the next page', () => {
    const source = ['A'.repeat(60 * 8), '', 'BOB', '(softly)', 'Hello.'].join('\n');
    const pages = bodyPages(source);

    expect(pages[0]?.lines.at(-1)).toMatchObject({ kind: 'character', text: 'BOB' });
    expect(pages[1]?.lines.map((line) => line.kind)).toEqual(['parenthetical', 'dialogue']);
  });

  it('keeps each spoken-text block intact while allowing its cue to use the previous page', () => {
    const source = ['A'.repeat(60 * 7), '', 'BOB', 'word '.repeat(10)].join('\n');
    const pages = bodyPages(source, 10);

    expect(pages[0]?.lines.at(-1)).toMatchObject({ kind: 'character', text: 'BOB' });
    expect(pages[1]?.lines[0]).toMatchObject({ kind: 'dialogue' });
    expect(pages.flatMap((page) => page.lines).some((line) => line.continuation)).toBe(false);
  });

  it('centers lyrics while retaining one structural gap for every lyric block', () => {
    const lines = bodyPages(['SINGER', '~First lyric', '~Second lyric'].join('\n'))[0]?.lines ?? [];
    const lyrics = lines.filter((line) => line.kind === 'lyric');

    expect(lyrics.map((line) => [line.text, line.x, line.baselineY, line.font])).toEqual([
      ['First lyric', 100.75, 745, 'italic'],
      ['Second lyric', 100.75, 721, 'italic'],
    ]);
  });

  it('keeps identical adjacent cues sequential when the second cue has a dual marker', () => {
    const lines = bodyPages(['OPIK', 'First.', '', 'OPIK^', 'Second.'].join('\n'))[0]?.lines ?? [];

    expect(lines.filter((line) => line.dualColumn)).toEqual([]);
    expect(lines.map((line) => line.text)).toEqual(['OPIK', 'First.', 'OPIK', 'Second.']);
  });

  it('paginates unequal dual dialogue with column-specific MORE and CONT’D cues', () => {
    const source = ['BOB', 'Short.', '', 'ALICE^', 'Right side keeps speaking. '.repeat(30)].join(
      '\n',
    );
    const pages = buildScreenplayPreview(source, {
      paperSize: 'a4',
      linesPerPage: 10,
      printDialogueContinuations: true,
    }).pages.filter((page) => page.pageNumber !== null);

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
    const lines =
      buildScreenplayPreview(source, {
        paperSize: 'a4',
        linesPerPage: 10,
        printRevisionMarks: true,
      }).pages[0]?.lines ?? [];

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

    expect(title?.inlineStyles).toEqual([
      { kind: 'bold', from: 0, to: 4 },
      { kind: 'underline', from: 0, to: 9 },
    ]);
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

    expect(columns).toEqual([60, 60, 38, 35, 35, 28, 60, 60, 60]);
    expect(kinds.map(screenplayBlockSpacingBefore)).toEqual([1, 1, 1, 0, 1, 0, 2, 0, 1]);
  });

  it('wraps blank paragraphs, multiple words, newlines, and overlong words deterministically', () => {
    expect(wrapScreenplayText('', 5)).toEqual(['']);
    expect(wrapScreenplayText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapScreenplayText('first\nsecond', 6)).toEqual(['first', 'second']);
    expect(wrapScreenplayText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapScreenplayText('A👩‍🚀e\u0301B', 2)).toEqual(['A👩‍🚀', 'e\u0301B']);
    expect(wrapScreenplayText(`${'A'.repeat(60)} next`, 60)).toEqual(['A'.repeat(60), 'next']);
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
