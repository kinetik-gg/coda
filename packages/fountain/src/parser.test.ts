import { describe, expect, it } from 'vitest';

import { parseFountain, serializeFountain } from './index';

describe('parseFountain', () => {
  it('preserves the exact source and identifies title-page fields', () => {
    const source =
      '\uFEFFTitle: The Last Test\r\nAuthor:\r\n   Ada Example\r\n   Lin Example\r\nDraft date: 2026-07-22\r\n\r\n';
    const document = parseFountain(source);

    expect(document.hasBom).toBe(true);
    expect(document.lineEnding).toBe('crlf');
    expect(serializeFountain(document)).toBe(source);
    expect(document.elements.map((element) => element.raw).join('')).toBe(source);
    expect(document.elements[0]).toMatchObject({
      kind: 'title_page',
      fields: [
        { key: 'Title', value: 'The Last Test' },
        { key: 'Author', value: 'Ada Example\nLin Example' },
        { key: 'Draft date', value: '2026-07-22' },
      ],
    });
  });

  it('parses scene headings, scene numbers, action, and forced action', () => {
    const source =
      'INT. WORKSHOP - NIGHT #A12#\n\nA clock ticks.\nAcross two action lines.\n\n!INT. is action here.\n\n.CUSTOM PLACE - DAY\n';
    const document = parseFountain(source);

    expect(document.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'scene_heading',
          text: 'INT. WORKSHOP - NIGHT',
          sceneNumber: 'A12',
          forced: false,
        }),
        expect.objectContaining({
          kind: 'action',
          text: 'A clock ticks.\nAcross two action lines.',
          forced: false,
        }),
        expect.objectContaining({ kind: 'action', text: 'INT. is action here.', forced: true }),
        expect.objectContaining({
          kind: 'scene_heading',
          text: 'CUSTOM PLACE - DAY',
          forced: true,
        }),
      ]),
    );
  });

  it('gives structural elements precedence over contextual character detection', () => {
    const source = 'INT. ROOM - DAY\nAction without a separating blank.\nCUT TO:\nNext action.\n';
    const elements = parseFountain(source).elements;

    expect(elements.map(({ kind }) => kind)).toEqual([
      'scene_heading',
      'action',
      'transition',
      'action',
    ]);
  });

  it('uses context for character cues, dialogue, parentheticals, and dual dialogue', () => {
    const source =
      '\nBOB (V.O.)\n(quietly)\nFirst line.\nSecond line.\n\n@Éowyn^\n(sings)\n~A lyric\nAnd dialogue.\n';
    const kinds = parseFountain(source).elements.map((element) => element.kind);

    expect(kinds).toEqual([
      'separator',
      'character',
      'parenthetical',
      'dialogue',
      'separator',
      'character',
      'parenthetical',
      'lyric',
      'dialogue',
    ]);
    expect(parseFountain(source).elements[1]).toMatchObject({
      kind: 'character',
      name: 'BOB',
      extension: '(V.O.)',
      dual: false,
    });
    expect(parseFountain(source).elements[5]).toMatchObject({
      kind: 'character',
      name: 'Éowyn',
      forced: true,
      dual: true,
    });
  });

  it('parses structural and presentational Fountain elements', () => {
    const source =
      '# Act One\n## Sequence One\n= A synopsis\n\n>THE END<\nCUT TO:\n> SMASH TO:\n~Song line\n===\n';
    const elements = parseFountain(source).elements;

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'section', text: 'Act One', depth: 1 }),
        expect.objectContaining({ kind: 'section', text: 'Sequence One', depth: 2 }),
        expect.objectContaining({ kind: 'synopsis', text: 'A synopsis' }),
        expect.objectContaining({ kind: 'centered', text: 'THE END' }),
        expect.objectContaining({ kind: 'transition', text: 'CUT TO:', forced: false }),
        expect.objectContaining({ kind: 'transition', text: 'SMASH TO:', forced: true }),
        expect.objectContaining({ kind: 'lyric', text: 'Song line' }),
        expect.objectContaining({ kind: 'page_break' }),
      ]),
    );
  });

  it('preserves standalone and inline notes and boneyards', () => {
    const source =
      '[[A standalone\nnote]]\n\nAction [[inline note]] remains.\n/* hidden\nscene */\nTrailing /* inline boneyard */ action.\n';
    const document = parseFountain(source);

    expect(document.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'note', text: 'A standalone\nnote', closed: true }),
        expect.objectContaining({ kind: 'boneyard', text: ' hidden\nscene ', closed: true }),
      ]),
    );
    expect(document.annotations.filter(({ kind }) => kind === 'note')).toHaveLength(2);
    expect(document.annotations.filter(({ kind }) => kind === 'boneyard')).toHaveLength(2);
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
  });

  it('records same-line emphasis without interpreting escaped markers', () => {
    const source = 'Some *italic*, **bold**, ***both***, and _underlined_. \\*literal*\n';
    const annotations = parseFountain(source).annotations;

    expect(annotations.map(({ kind }) => kind)).toEqual([
      'italic',
      'bold',
      'bold_italic',
      'underline',
    ]);
    for (const annotation of annotations) {
      expect(source.slice(annotation.start, annotation.end)).not.toContain('\n');
    }
  });

  it('falls back to Action for ambiguous and malformed input', () => {
    const source = 'MiXeD unknown syntax\nContinues here\n\nUNFOLLOWED CUE\n';
    const actions = parseFountain(source).elements.filter(({ kind }) => kind === 'action');

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ text: 'MiXeD unknown syntax\nContinues here' });
    expect(actions[1]).toMatchObject({ text: 'UNFOLLOWED CUE' });
  });

  it('reports mixed line endings and preserves missing final newlines', () => {
    const source = 'Action\r\nNext\nLast';
    const document = parseFountain(source);

    expect(document.lineEnding).toBe('mixed');
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
    expect(serializeFountain(document)).toBe(source);
  });

  it('keeps unclosed delimited content instead of dropping it', () => {
    const source = 'Before\n\n[[unfinished\nnote';
    const document = parseFountain(source);

    expect(document.elements.at(-1)).toMatchObject({ kind: 'note', closed: false });
    expect(document.annotations.at(-1)).toMatchObject({ kind: 'note', closed: false });
    expect(serializeFountain(document)).toBe(source);
  });
});
