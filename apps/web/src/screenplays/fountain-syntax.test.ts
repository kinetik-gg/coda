import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { classifyFountainLines, fountainSyntax } from './fountain-syntax';

describe('Fountain semantic highlighting', () => {
  it('uses the shared lossless parser to classify screenplay lines', () => {
    const source = [
      'Title: Test',
      '',
      '# Act One',
      '= Opening',
      '',
      'INT. ROOM - DAY',
      '',
      'ADA',
      '(quietly)',
      'Hello.',
      '~A lyric',
      '',
      '>THE END<',
      '',
      'CUT TO:',
      '',
      '===',
      '[[private note]]',
      '/* removed */',
    ].join('\n');

    expect(classifyFountainLines(source)).toEqual([
      'title-page',
      'action',
      'section',
      'synopsis',
      'action',
      'scene',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'lyric',
      'action',
      'centered',
      'action',
      'transition',
      'action',
      'page-break',
      'note',
      'boneyard',
    ]);
  });

  it('falls back to action for unclassified lines and an empty document', () => {
    expect(classifyFountainLines('ordinary prose\n\n')).toEqual(['action', 'action', 'action']);
    expect(classifyFountainLines('')).toEqual(['action']);
  });

  it('follows shared parser boundaries for automatic and forced screenplay syntax', () => {
    expect(classifyFountainLines('INT. ROOM - DAY\nAction immediately.')).toEqual([
      'action',
      'action',
    ]);
    expect(classifyFountainLines('Action.\n\nCUT TO:\nNext immediately.')).toEqual([
      'action',
      'action',
      'action',
      'action',
    ]);
    expect(classifyFountainLines('CUT TO:   \nFollowing action.')).toEqual(['action', 'action']);
    expect(classifyFountainLines('.OPENING IMAGE\nAction.\n>SMASH TO:\nAction.')).toEqual([
      'scene',
      'action',
      'transition',
      'action',
    ]);
  });

  it('rebuilds semantic and inline-mark decorations as the document changes', () => {
    const source = [
      'Title: Decorated',
      '',
      'INT. ROOM - DAY',
      '',
      'ADA',
      'This is **bold**, *italic*, _underlined_, and ***both***.',
      '[[a note]]',
      '/* omitted */',
    ].join('\n');
    const state = EditorState.create({ doc: source, extensions: [fountainSyntax()] });

    const selectionOnly = state.update({ selection: { anchor: 1 } }).state;
    expect(selectionOnly.doc.toString()).toBe(source);

    const changed = selectionOnly.update({
      changes: { from: 0, to: selectionOnly.doc.length, insert: '>THE END<' },
    }).state;
    expect(changed.doc.toString()).toBe('>THE END<');
    expect(classifyFountainLines(changed.doc.toString())).toEqual(['centered']);
  });
});
