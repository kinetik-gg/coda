// @vitest-environment jsdom

import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { applyFountainFormat } from './screenplay-formatting';

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

function createView(doc: string, anchor: number, head = anchor) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
    }),
  });
  return view;
}

describe('applyFountainFormat', () => {
  it('wraps selected text and keeps the original text selected', () => {
    const editor = createView('A quiet room.', 2, 7);

    expect(applyFountainFormat(editor, 'bold')).toBe(true);

    expect(editor.state.doc.toString()).toBe('A **quiet** room.');
    expect(editor.state.sliceDoc(...selectionBounds(editor))).toBe('quiet');
  });

  it('places the cursor inside an empty inline wrapper', () => {
    const editor = createView('MAYA\n', 5);

    expect(applyFountainFormat(editor, 'parenthetical')).toBe(true);

    expect(editor.state.doc.toString()).toBe('MAYA\n()');
    expect(editor.state.selection.main.anchor).toBe(6);
  });

  it('applies line markers across a selection while preserving indentation', () => {
    const source = '  Existing action\n@MAYA';
    const editor = createView(source, 0, source.length);

    expect(applyFountainFormat(editor, 'scene-heading')).toBe(true);

    expect(editor.state.doc.toString()).toBe('  .Existing action\n.MAYA');
  });

  it('replaces an existing forced marker instead of stacking markers', () => {
    const editor = createView('!A deliberate action', 0);

    expect(applyFountainFormat(editor, 'character')).toBe(true);

    expect(editor.state.doc.toString()).toBe('@A deliberate action');
  });

  it('inserts a Fountain page break after the current final line', () => {
    const source = 'FADE OUT.';
    const editor = createView(source, source.length);

    expect(applyFountainFormat(editor, 'page-break')).toBe(true);

    expect(editor.state.doc.toString()).toBe('FADE OUT.\n\n===\n');
    expect(editor.state.selection.main.anchor).toBe(editor.state.doc.length);
  });
});

function selectionBounds(editor: EditorView): [number, number] {
  const selection = editor.state.selection.main;
  return [selection.from, selection.to];
}
