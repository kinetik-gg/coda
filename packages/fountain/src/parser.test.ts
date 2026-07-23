import { describe, expect, it } from 'vitest';

import { fountainRevisionMarker, parseFountain, serializeFountain } from './index';

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

  it.each([
    ['INT. ROOM - DAY #A-1.2#\n', 'A-1.2'],
    ['EXT. CAFÉ - NIGHT #É2#\n', 'É2'],
  ])('accepts a constrained scene number in %s', (source, sceneNumber) => {
    expect(parseFountain(source).elements[0]).toMatchObject({
      kind: 'scene_heading',
      sceneNumber,
    });
  });

  it.each(['INT. ROOM - DAY #A B#\n', 'INT. ROOM - DAY #A/B#\n', 'INT. ROOM - DAY #?#\n'])(
    'leaves an invalid scene-number suffix in the heading text: %s',
    (source) => {
      const element = parseFountain(source).elements[0];
      expect(element).toMatchObject({
        kind: 'scene_heading',
        text: source.trimEnd(),
      });
      expect(element).not.toHaveProperty('sceneNumber');
    },
  );

  it('keeps transition-looking text as action when forced with an exclamation mark', () => {
    expect(parseFountain('!CUT TO:').elements).toEqual([
      expect.objectContaining({ kind: 'action', text: 'CUT TO:', forced: true }),
    ]);
  });

  it.each([
    'INT. WORKSHOP - NIGHT',
    'EXT FOREST - NIGHT',
    'EST. CITY - DAWN',
    'INT./EXT. CAR - DAY',
    'INT/EXT CAR - DAY',
    'I/E. DOORWAY - CONTINUOUS',
    'ext. brick’s pool - day',
  ])('preserves the complete standard scene heading: %s', (heading) => {
    const element = parseFountain(`${heading}\n`).elements[0];

    expect(element).toMatchObject({ kind: 'scene_heading', text: heading, forced: false });
    expect(element?.raw).toBe(`${heading}\n`);
  });

  it.each([
    ['.SNIPER SCOPE POV', 'SNIPER SCOPE POV'],
    ['.EXT. HUTAN - NIGHT', 'EXT. HUTAN - NIGHT'],
    ['.INT./EXT. CAR - DAY', 'INT./EXT. CAR - DAY'],
    ['.ÉTAGE SUPÉRIEUR', 'ÉTAGE SUPÉRIEUR'],
  ])('removes only the forcing period from scene heading %s', (sourceLine, text) => {
    const element = parseFountain(`${sourceLine}\n`).elements[0];

    expect(element).toMatchObject({ kind: 'scene_heading', text, forced: true });
    expect(element?.raw).toBe(`${sourceLine}\n`);
  });

  it.each(['...where the action continues.', '..NOT A HEADING', '. NOT A HEADING'])(
    'does not treat a non-alphanumeric leading period as a forced scene heading: %s',
    (sourceLine) => {
      expect(parseFountain(`${sourceLine}\n`).elements[0]).toMatchObject({
        kind: 'action',
        text: sourceLine,
      });
    },
  );

  it.each(['!INT. ROOM - DAY', '!EXT. HUTAN - NIGHT', '!!THE END'])(
    'keeps a forced-action line out of scene and character classification: %s',
    (sourceLine) => {
      expect(parseFountain(`${sourceLine}\n`).elements[0]).toMatchObject({
        kind: 'action',
        text: sourceLine.slice(1),
        forced: true,
      });
    },
  );

  it('requires blank context before automatic scene headings and transitions', () => {
    const source =
      'Action.\nINT. NOT A HEADING - DAY\nCUT TO:\nTail.\n\n.INT. FORCED - DAY\n>SMASH TO:\n';
    const elements = parseFountain(source).elements;

    expect(elements.map(({ kind }) => kind)).toEqual([
      'action',
      'separator',
      'scene_heading',
      'transition',
    ]);
    expect(elements[0]).toMatchObject({
      kind: 'action',
      text: 'Action.\nINT. NOT A HEADING - DAY\nCUT TO:\nTail.',
    });
    expect(elements[2]).toMatchObject({ kind: 'scene_heading', forced: true });
    expect(elements[3]).toMatchObject({ kind: 'transition', forced: true });
  });

  it('recognizes automatic scene headings and transitions at a document or blank boundary', () => {
    const source = 'INT. ROOM - DAY\n\nAction.\n\nCUT TO:\n';

    expect(parseFountain(source).elements.map(({ kind }) => kind)).toEqual([
      'scene_heading',
      'separator',
      'action',
      'separator',
      'transition',
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
      '# Act One\n## Sequence One\n= A synopsis\n\n>THE END<\n\nCUT TO:\n\n> SMASH TO:\n~Song line\n===\n';
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

  it('keeps notes and boneyards out of Action and Dialogue semantic text', () =>
    expectHiddenContentExcludedFromSemantics());

  it('stops an unclosed note at an unconnected empty paragraph', () => {
    const source = '[[unfinished\nbody\n\nEXT. VISIBLE - DAY\n';
    const document = parseFountain(source);

    expect(document.elements.map(({ kind }) => kind)).toEqual([
      'note',
      'separator',
      'scene_heading',
    ]);
    expect(document.elements[0]).toMatchObject({
      kind: 'note',
      text: 'unfinished\nbody',
      closed: false,
    });
    expect(document.annotations.find(({ kind }) => kind === 'note')).toMatchObject({
      kind: 'note',
      closed: false,
      end: source.indexOf('\n\n') + 1,
    });
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
    expect(serializeFountain(document)).toBe(source);
  });

  it.each([
    ['  ', true],
    ['\t', true],
    [' ', false],
    ['', false],
  ])('treats %j as a %s multiline-note connection', (blankLine, connected) => {
    const source = `[[open\n${blankLine}\nclose]]\n`;
    const document = parseFountain(source);
    const note = document.elements[0];

    if (connected) {
      expect(note).toMatchObject({ kind: 'note', text: `open\n${blankLine}\nclose`, closed: true });
    } else {
      expect(note).toMatchObject({ kind: 'note', text: 'open', closed: false });
    }
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
  });

  it('keeps printable content after a note or boneyard closer visible as Action', () => {
    const source = '[[hidden]]Visible action.\n/* hidden\nINT. FAKE - NIGHT\n*/Still visible.\n';
    const document = parseFountain(source);

    expect(document.elements.map(({ kind }) => kind)).toEqual(['action', 'action']);
    expect(document.elements[0]).toMatchObject({ text: 'Visible action.' });
    expect(document.elements[1]).toMatchObject({
      text: 'Still visible.',
    });
    expect(document.annotations.filter(({ kind }) => kind === 'note')).toHaveLength(1);
    expect(document.annotations.filter(({ kind }) => kind === 'boneyard')).toHaveLength(1);
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
  });

  it('does not absorb imported boneyard metadata into title fields or dialogue', () => {
    const metadata = `/* If you're seeing this - BEAT: {"Review Ranges":[]} */`;

    expect(parseFountain(metadata).elements[0]).toMatchObject({ kind: 'boneyard' });
    expect(parseFountain(`!!THE END\n${metadata}`).elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'action', forced: true, text: '!THE END' }),
        expect.objectContaining({ kind: 'boneyard' }),
      ]),
    );
  });

  it('keeps multiline imported metadata in one boneyard after forced action', () => {
    const metadata = [
      '/* If you’re seeing this, you can remove the following stuff - BEAT:',
      '{"Review Ranges":[],"Revision":{"Removed":[]},',
      '"Addition":[[0,155,7],[156,33,7]]}',
      '*/',
    ].join('\n');
    const source = `!!THE END\n${metadata}\n`;
    const document = parseFountain(source);

    expect(document.elements.map(({ kind }) => kind)).toEqual(['action', 'boneyard']);
    expect(document.elements[0]).toMatchObject({
      kind: 'action',
      text: '!THE END',
      forced: true,
      lineStart: 0,
      lineEnd: 0,
    });
    expect(document.elements[1]).toMatchObject({
      kind: 'boneyard',
      closed: true,
      lineStart: 1,
      lineEnd: 4,
    });
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
  });

  it('does not parse screenplay syntax inside a boneyard', () => {
    const source = [
      '/*',
      'INT. HIDDEN ROOM - NIGHT',
      '',
      'HIDDEN CHARACTER',
      'Hidden dialogue.',
      '*/',
      '',
      'EXT. VISIBLE FOREST - DAY',
      '',
    ].join('\n');
    const elements = parseFountain(source).elements;

    expect(elements.filter(({ kind }) => kind === 'boneyard')).toHaveLength(1);
    expect(elements.filter(({ kind }) => kind === 'scene_heading')).toEqual([
      expect.objectContaining({ text: 'EXT. VISIBLE FOREST - DAY' }),
    ]);
    expect(elements.filter(({ kind }) => kind === 'character')).toHaveLength(0);
  });

  it('reads compatible embedded revision ranges without exposing arbitrary metadata', () => {
    const screenplay = 'INT. ROOM - DAY\n\nChanged line.';
    const metadata = {
      Revision: {
        Removed: [],
        RemovalSuggestion: [[4, 3, 5]],
        Addition: [
          [0, 3, 0],
          [18, 7, 7],
          [-1, 3, 0],
          [screenplay.length - 1, 9, 0],
        ],
      },
      'Revision Mode': true,
      'Revision Level': 7,
      'Text Length': screenplay.length,
      Secret: 'not part of the public model',
    };
    const source = `${screenplay}\n\n/* If you're seeing this, it is editor metadata. BEAT: ${JSON.stringify(metadata)} END_BEAT */`;

    expect(parseFountain(source).revisionMetadata).toEqual({
      enabled: true,
      currentGeneration: 7,
      textLength: screenplay.length,
      ranges: [
        { start: 0, end: 3, generation: 0, kind: 'addition' },
        { start: 4, end: 7, generation: 5, kind: 'removal_suggestion' },
        { start: 18, end: 25, generation: 7, kind: 'addition' },
      ],
    });
  });

  it('ignores malformed embedded revision metadata', () => {
    const source = 'INT. ROOM - DAY\n\n/* BEAT: {not json} END_BEAT */';
    expect(parseFountain(source).revisionMetadata).toBeUndefined();
  });

  it('maps all eight revision generations to their standard print markers', () => {
    expect(
      Array.from({ length: 8 }, (_, generation) =>
        fountainRevisionMarker(generation as Parameters<typeof fountainRevisionMarker>[0]),
      ),
    ).toEqual(['*', '**', '+', '++', '@', '@@', '#', '##']);
  });

  it.each(['/* metadata: value */', '   /* metadata: value */', '\uFEFF/* metadata: value */'])(
    'does not mistake a leading boneyard for title-page data: %s',
    (source) => {
      const document = parseFountain(source);

      expect(document.elements[0]).toMatchObject({ kind: 'boneyard', closed: true });
      expect(document.elements.some(({ kind }) => kind === 'title_page')).toBe(false);
    },
  );

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

  it('requires non-whitespace emphasis boundaries and recognizes nested emphasis', () => {
    expect(parseFountain('He dialed *69 and then *23.').annotations).toEqual([]);

    const source = '_an *italicized* word_ and **bold with *nested* words**';
    const annotations = parseFountain(source).annotations;
    expect(annotations.map(({ kind }) => kind)).toEqual(['underline', 'italic', 'bold', 'italic']);
    expect(source.slice(annotations[0]?.contentStart, annotations[0]?.contentEnd)).toBe(
      'an *italicized* word',
    );
  });

  it('supports combined emphasis while leaving escaped markers literal', () => {
    const source = '***both*** and _an \\*escaped* marker_';
    const annotations = parseFountain(source).annotations;

    expect(annotations.map(({ kind }) => kind)).toEqual(['bold_italic', 'underline']);
    expect(source.slice(annotations[1]?.contentStart, annotations[1]?.contentEnd)).toBe(
      'an \\*escaped* marker',
    );
  });

  it('normalizes indentation for non-Action text and expands Action tabs without source loss', () => {
    const source = '  INT. ROOM - DAY\n\n\tBOB\n    Hello.\n\n\tIndented\tAction\n';
    const document = parseFountain(source);

    expect(document.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'scene_heading', text: 'INT. ROOM - DAY' }),
        expect.objectContaining({ kind: 'character', name: 'BOB' }),
        expect.objectContaining({ kind: 'dialogue', text: 'Hello.' }),
        expect.objectContaining({ kind: 'action', text: '    Indented    Action' }),
      ]),
    );
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
    expect(serializeFountain(document)).toBe(source);
  });

  it('parses adversarial marker input in bounded time while preserving source', () => {
    const unmatchedMarkers = `${'*a '.repeat(10_000)}${'x_ '.repeat(10_000)}`;
    const unclosedNotes = '[[open\n\n'.repeat(5_000);
    const source = `${unmatchedMarkers}\n\n${unclosedNotes}Tail`;
    const startedAt = Date.now();
    const document = parseFountain(source);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(serializeFountain(document)).toBe(source);
    expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
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

function expectHiddenContentExcludedFromSemantics(): void {
  const source = [
    'Action [[private direction]] remains /*discarded action*/ visible.',
    '',
    'BOB',
    'Hello [[private dialogue]] there /*discarded dialogue*/.',
    '',
    'CAROL',
    'Still audible.',
    '[[standalone note]]',
  ].join('\n');
  const document = parseFountain(source);

  expect(document.elements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'action', text: 'Action  remains  visible.' }),
      expect.objectContaining({ kind: 'dialogue', text: 'Hello  there .' }),
      expect.objectContaining({ kind: 'dialogue', text: 'Still audible.' }),
      expect.objectContaining({ kind: 'note', text: 'standalone note' }),
    ]),
  );
  expect(document.elements.map(({ kind }) => kind)).toEqual([
    'action',
    'separator',
    'character',
    'dialogue',
    'separator',
    'character',
    'dialogue',
    'note',
  ]);
  for (const element of document.elements) {
    expect(source.slice(element.start, element.end)).toBe(element.raw);
  }
  expect(document.elements.map(({ raw }) => raw).join('')).toBe(source);
  expect(serializeFountain(document)).toBe(source);
}
