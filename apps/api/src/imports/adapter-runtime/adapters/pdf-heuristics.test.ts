import { describe, expect, it } from 'vitest';
import { classifyPdfPages, renderPdfBlock } from './pdf-heuristics';
import type { PdfExtractedPage } from './pdf-extract';

function page(
  pageIndex: number,
  lines: readonly { text: string; x: number }[],
  pageWidth = 612,
): PdfExtractedPage {
  return {
    pageIndex,
    pageWidth,
    lines: lines.map((line, index) => ({ ...line, y: 700 - index * 14 })),
  };
}

describe('classifyPdfPages', () => {
  it('classifies a scene heading, character/dialogue block, and transition with certainty', () => {
    const blocks = classifyPdfPages([
      page(0, [
        { text: 'EXT. STREET - DAY', x: 108 },
        { text: '', x: 108 },
        { text: 'Rain falls on the empty road.', x: 108 },
        { text: '', x: 108 },
        { text: 'RILEY', x: 266 },
        { text: 'We should go now.', x: 180 },
        { text: '', x: 108 },
        { text: 'CUT TO:', x: 400 },
      ]),
    ]);
    const kinds = blocks.map((block) => block.kind);
    expect(kinds).toEqual(['scene_heading', 'action', 'character', 'dialogue', 'transition']);
    expect(blocks.every((block) => block.confidence === 'certain')).toBe(true);
  });

  it('splits a parenthetical out of a dialogue speech into its own block', () => {
    const blocks = classifyPdfPages([
      page(0, [
        { text: 'RILEY', x: 266 },
        { text: 'We should go now.', x: 180 },
        { text: '(beat)', x: 200 },
        { text: 'Right now.', x: 180 },
      ]),
    ]);
    expect(blocks.map((block) => block.kind)).toEqual([
      'character',
      'dialogue',
      'parenthetical',
      'dialogue',
    ]);
  });

  it('flags an indentation-only character guess as uncertain', () => {
    const blocks = classifyPdfPages([page(0, [{ text: 'MEANWHILE', x: 108 }])]);
    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'character', confidence: 'uncertain' }),
    ]);
  });

  it('merges consecutive action lines from the same paragraph into one block', () => {
    const blocks = classifyPdfPages([
      page(0, [
        { text: 'The room is dark.', x: 108 },
        { text: 'A single lamp flickers.', x: 108 },
      ]),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'action' });
    expect(blocks[0]?.lines).toEqual(['The room is dark.', 'A single lamp flickers.']);
  });
});

describe('renderPdfBlock', () => {
  it('forces a scene heading that does not match the natural INT/EXT pattern', () => {
    const text = renderPdfBlock({
      kind: 'scene_heading',
      pageIndex: 0,
      confidence: 'uncertain',
      lines: ['LATER'],
    });
    expect(text).toBe('.LATER');
  });

  it('leaves a natural INT/EXT scene heading unforced', () => {
    const text = renderPdfBlock({
      kind: 'scene_heading',
      pageIndex: 0,
      confidence: 'certain',
      lines: ['INT. HOUSE - DAY'],
    });
    expect(text).toBe('INT. HOUSE - DAY');
  });

  it('neutralizes action text that would otherwise collide with a structural marker', () => {
    const text = renderPdfBlock({
      kind: 'action',
      pageIndex: 0,
      confidence: 'certain',
      lines: ['@handle appears on the screen.'],
    });
    expect(text).toBe('!@handle appears on the screen.');
  });

  it('forces character and transition lines', () => {
    expect(
      renderPdfBlock({ kind: 'character', pageIndex: 0, confidence: 'certain', lines: ['RILEY'] }),
    ).toBe('@RILEY');
    expect(
      renderPdfBlock({
        kind: 'transition',
        pageIndex: 0,
        confidence: 'certain',
        lines: ['CUT TO:'],
      }),
    ).toBe('>CUT TO:');
  });

  it('wraps a parenthetical that lost its parentheses', () => {
    const text = renderPdfBlock({
      kind: 'parenthetical',
      pageIndex: 0,
      confidence: 'certain',
      lines: ['beat'],
    });
    expect(text).toBe('(beat)');
  });
});
