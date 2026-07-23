import { describe, expect, it } from 'vitest';
import { buildScreenplayPreview, findPreviewBlockAtOffset } from './screenplay-preview-model';
import { screenplayPaper } from './screenplay-paper';

describe('screenplay preview model', () => {
  it('builds printable pages and a stable scene outline while omitting authoring metadata', () => {
    const source = [
      'Title: Blue Hour',
      'Author: A. Writer',
      '',
      '# Act One',
      '= The opening',
      '[[private note]]',
      '',
      'INT. KITCHEN - DAY #1#',
      '',
      'ADA',
      '(quietly)',
      'We should go.',
      '',
      '/* omitted action */',
      '',
      'EXT. STREET - NIGHT #2A#',
      '',
      '>CUT TO:',
    ].join('\n');

    const model = buildScreenplayPreview(source);

    expect(model.pages[0]).toMatchObject({ id: 'preview-title-page', pageNumber: null });
    expect(model.pages[1]).toMatchObject({ pageNumber: 1 });
    expect(model.scenes).toEqual([
      expect.objectContaining({
        id: 'scene-1-int-kitchen-day',
        label: 'INT. KITCHEN - DAY',
        sceneNumber: '1',
        line: 8,
        pageNumber: 1,
      }),
      expect.objectContaining({
        id: 'scene-2-ext-street-night',
        label: 'EXT. STREET - NIGHT',
        sceneNumber: '2A',
        line: 16,
        pageNumber: 1,
      }),
    ]);
    expect(model.printableBlocks.map((block) => block.kind)).not.toEqual(
      expect.arrayContaining(['note', 'boneyard', 'section', 'synopsis']),
    );
    expect(model.printableBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'character', text: 'ADA' }),
        expect.objectContaining({ kind: 'parenthetical', text: '(quietly)' }),
        expect.objectContaining({ kind: 'dialogue', text: 'We should go.' }),
        expect.objectContaining({ kind: 'transition', text: 'CUT TO:' }),
      ]),
    );
  });

  it('honors explicit page breaks and keeps a scene heading off the final orphan line', () => {
    const longAction = 'A'.repeat(500);
    const explicit = buildScreenplayPreview(
      ['INT. ONE - DAY', '', 'First page.', '===', '', 'INT. TWO - NIGHT'].join('\n'),
    );
    expect(explicit.pages.filter((page) => page.pageNumber !== null)).toHaveLength(2);
    expect(explicit.scenes.map((scene) => scene.pageNumber)).toEqual([1, 2]);

    const orphanSafe = buildScreenplayPreview(`${longAction}\n\nINT. NEXT - DAY`, {
      linesPerPage: 10,
    });
    expect(orphanSafe.scenes[0]?.pageNumber).toBe(2);

    const exactlyFourLinesRemain = buildScreenplayPreview(
      `${'A'.repeat(63 * 6)}\n\nINT. ALSO NEXT - DAY`,
      { linesPerPage: 10 },
    );
    expect(exactlyFourLinesRemain.scenes[0]?.pageNumber).toBe(2);
  });

  it('omits inline notes and applies custom page numbers to the page where the note sits', () => {
    const source = ['Visible [[private note]] action.', '===', '[[page 3A]]', 'Next page.'].join(
      '\n',
    );
    const model = buildScreenplayPreview(source, { paperSize: 'a4' });

    expect(model.pages[0]?.lines.map((line) => line.text).join(' ')).not.toContain('private note');
    expect(model.pages[1]?.printedPageNumber).toBe('3A');
    expect(
      model.pages
        .flatMap((page) => page.lines)
        .map((line) => line.text)
        .join(' '),
    ).not.toContain('page 3A');
  });

  it('retains exact source offsets around hidden inline annotations', () => {
    const source = 'Visible [[private note]] action /*old*/ remains.';
    const block = buildScreenplayPreview(source).printableBlocks[0];
    const actionStart = block?.text.indexOf('action') ?? -1;
    const remainsStart = block?.text.indexOf('remains') ?? -1;

    expect(block?.text).toBe('Visible  action  remains.');
    expect(block?.textSourceOffsets).toHaveLength((block?.text.length ?? 0) + 1);
    expect(block?.textSourceOffsets?.[actionStart]).toBe(source.indexOf('action'));
    expect(block?.textSourceOffsets?.[remainsStart]).toBe(source.indexOf('remains'));
  });

  it('preserves connected blank dialogue as an exact canonical row', () => {
    const source = ['BOB', 'First.', '  ', 'Second.'].join('\n');
    const dialogueLines = buildScreenplayPreview(source, {
      paperSize: 'a4',
    }).pages[0]?.lines.filter((line) => line.kind === 'dialogue');

    expect(dialogueLines?.map((line) => line.text)).toEqual(['First.', '', 'Second.']);
    expect(dialogueLines?.map((line) => line.baselineY)).toEqual([757, 745, 733]);
    expect(dialogueLines?.[1]).toMatchObject({
      sourceStart: source.indexOf('  '),
      sourceEnd: source.indexOf('Second.'),
      textSourceOffsets: [source.indexOf('  '), source.indexOf('Second.')],
    });
  });

  it('always provides an empty first page for a blank screenplay', () => {
    const model = buildScreenplayPreview('');
    expect(model.pages).toEqual([{ id: 'preview-page-1', pageNumber: 1, blocks: [], lines: [] }]);
    expect(model.scenes).toEqual([]);
  });

  it('maps editor offsets to the containing or nearest printable block', () => {
    const source = 'INT. ROOM - DAY\n\nAction.\n\nEXT. ROAD - NIGHT';
    const model = buildScreenplayPreview(source);
    const scenes = model.printableBlocks.filter((block) => block.kind === 'scene-heading');
    expect(findPreviewBlockAtOffset(model, scenes[0]!.sourceStart)?.id).toBe(scenes[0]!.id);
    expect(findPreviewBlockAtOffset(model, source.length + 20)?.id).toBe(scenes[1]!.id);
    expect(findPreviewBlockAtOffset(model, -10)?.id).toBe(model.printableBlocks[0]?.id);
    expect(findPreviewBlockAtOffset(buildScreenplayPreview(''), 0)).toBeUndefined();
  });

  it('maps rendered text boundaries to exact Fountain offsets and preserves character extensions', () => {
    const source = '.A forced heading\r\n\r\nBOB (V.O.)\r\nHello there.';
    const blocks = buildScreenplayPreview(source).printableBlocks;
    const heading = blocks.find((block) => block.kind === 'scene-heading');
    const character = blocks.find((block) => block.kind === 'character');

    expect(heading).toMatchObject({
      text: 'A forced heading',
      textSourceStart: 1,
      textSourceEnd: 17,
    });
    expect(heading?.textSourceOffsets).toHaveLength('A forced heading'.length + 1);
    expect(character).toMatchObject({
      text: 'BOB (V.O.)',
      textSourceStart: source.indexOf('BOB'),
      textSourceEnd: source.indexOf('BOB') + 'BOB (V.O.)'.length,
    });

    const titleSource = 'Title: First line\r\n   Second line';
    const titleField = buildScreenplayPreview(titleSource).printableBlocks[0]?.titleFields?.[0];
    expect(titleField?.textSourceOffsets?.['First line\n'.length]).toBe(
      titleSource.indexOf('Second line'),
    );
  });

  it('removes Fountain emphasis markers while retaining styled source ranges', () => {
    const source = 'Action with **bold** and _underlined_ words.';
    const block = buildScreenplayPreview(source).printableBlocks[0];

    expect(block).toMatchObject({
      displayText: 'Action with bold and underlined words.',
      inlineStyles: [
        { kind: 'bold', from: 12, to: 16 },
        { kind: 'underline', from: 21, to: 31 },
      ],
    });
    expect(block?.textSourceOffsets).toHaveLength((block?.displayText?.length ?? 0) + 1);
  });

  it('emits exact immutable A4 line geometry with automatic scene numbers', () => {
    const paper = screenplayPaper('a4');
    const model = buildScreenplayPreview('INT. ROOM - DAY\n\nAction.', { paperSize: 'a4' });
    const firstLine = model.pages[0]?.lines[0];

    expect(paper).toMatchObject({
      widthPoints: 595,
      heightPoints: 842,
      glyphWidth: 7.25,
      firstBodyBaseline: 769,
      pageNumberBaseline: 805.5,
      linesPerPage: 59,
    });
    expect(firstLine).toMatchObject({
      kind: 'scene-heading',
      x: 101.5,
      baselineY: 769,
      columns: 55,
      sceneNumber: '1',
    });
    expect(Object.isFrozen(model.pages[0]?.lines)).toBe(true);
  });

  it('uses the canonical half-point body baseline shift after screenplay page one', () => {
    const model = buildScreenplayPreview('Action one.\n\n===\n\nAction two.', {
      paperSize: 'a4',
    });

    expect(model.pages[0]?.lines[0]?.baselineY).toBe(769);
    expect(model.pages[1]?.lines[0]?.baselineY).toBe(769.5);
  });

  it('matches the measured A4 title-page grid and 65/35 lower columns', () => {
    const source = [
      'Title: Northern Lights',
      'Credit: Written by Example Studio',
      'Author: A. Writer',
      'Source: Original screenplay',
      'Draft date: Third draft, 12 March',
      '   2026',
    ].join('\n');
    const lines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];

    expect(lines.slice(0, 4)).toEqual([
      expect.objectContaining({
        text: 'NORTHERN LIGHTS',
        x: 42.5,
        width: 515,
        baselineY: 551.5,
      }),
      expect.objectContaining({ text: 'Written by Example Studio', baselineY: 503.5 }),
      expect.objectContaining({ text: 'A. Writer', baselineY: 479.5 }),
      expect.objectContaining({ text: 'Original screenplay', baselineY: 455.5 }),
    ]);
    expect(lines.slice(4)).toEqual([
      expect.objectContaining({
        text: 'Third draft, 12 March',
        x: 374.75,
        width: 165.25,
        baselineY: 100.5,
        align: 'right',
      }),
      expect.objectContaining({ text: '2026', baselineY: 88.5, align: 'right' }),
    ]);
  });

  it('paginates long dialogue with canonical MORE and CONT’D lines', () => {
    const source = `BOB\n${'A spoken sentence. '.repeat(40)}`;
    const bodyPages = buildScreenplayPreview(source, { linesPerPage: 10 }).pages;

    expect(bodyPages.length).toBeGreaterThan(1);
    expect(bodyPages[0]?.lines.at(-1)).toMatchObject({ text: '(MORE)', continuation: 'more' });
    expect(bodyPages[1]?.lines[0]).toMatchObject({
      text: "BOB (CONT'D)",
      continuation: 'continued',
    });
  });

  it('never strands a dialogue cue above MORE without spoken text', () => {
    const source = `${'Action row. '.repeat(40)}\n\nBOB\n${'Spoken words. '.repeat(40)}`;
    const pages = buildScreenplayPreview(source, { linesPerPage: 10 }).pages;
    const firstCuePage = pages.findIndex((page) => page.lines.some((line) => line.text === 'BOB'));
    const cueIndex = pages[firstCuePage]?.lines.findIndex((line) => line.text === 'BOB') ?? -1;

    expect(firstCuePage).toBeGreaterThanOrEqual(0);
    expect(pages[firstCuePage]?.lines[cueIndex + 1]?.kind).toBe('dialogue');
  });

  it('applies print transforms and measured continuation/centered widths', () => {
    const source = [
      '.lower heading',
      '',
      '@alice',
      '(a parenthetical long enough to wrap onto a continuation line here)',
      'Dialogue.',
      '',
      '>lower transition',
      '',
      '>centered text<',
    ].join('\n');
    const a4Lines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];
    const parentheticals = a4Lines.filter((line) => line.kind === 'parenthetical');
    const centered = buildScreenplayPreview('>centered text<', { paperSize: 'letter' }).pages[0]
      ?.lines[0];

    expect(a4Lines.some((line) => line.text === 'LOWER HEADING')).toBe(true);
    expect(a4Lines.some((line) => line.text === 'ALICE')).toBe(true);
    expect(a4Lines.some((line) => line.text === 'LOWER TRANSITION')).toBe(true);
    expect(parentheticals[1]?.x).toBe((parentheticals[0]?.x ?? 0) + 7.25);
    expect(parentheticals[1]?.columns).toBe((parentheticals[0]?.columns ?? 0) - 1);
    expect(centered?.columns).toBe(62);
  });

  it('lays dual dialogue into shared rows with distinct canonical columns', () => {
    const source = ['BOB', 'Left side.', '', 'ALICE^', 'Right side.'].join('\n');
    const lines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];
    const leftCue = lines.find((line) => line.text === 'BOB');
    const rightCue = lines.find((line) => line.text === 'ALICE');

    expect(leftCue).toMatchObject({ dualColumn: 'left', baselineY: 769 });
    expect(rightCue).toMatchObject({ dualColumn: 'right', baselineY: 769 });
    expect(rightCue?.x).toBeGreaterThan(leftCue?.x ?? 0);
  });

  it('uses the canonical title-page center and lower-right edge', () => {
    const source = [
      'Title: Blue Hour',
      'Draft date: Third draft, 12 March 2026',
      '',
      'INT. ROOM - DAY',
    ].join('\n');
    const titleLines = buildScreenplayPreview(source, { paperSize: 'a4' }).pages[0]?.lines ?? [];
    const title = titleLines.find((line) => line.text === 'BLUE HOUR');
    const dateLines = titleLines.filter((line) => line.align === 'right');

    expect((title?.x ?? 0) + (title?.width ?? 0) / 2).toBe(300);
    expect(dateLines.map((line) => line.x + line.width)).toEqual([540, 540]);
    expect(dateLines.map((line) => line.baselineY)).toEqual([100.5, 88.5]);
  });
});
