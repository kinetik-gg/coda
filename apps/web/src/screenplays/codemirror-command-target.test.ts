// @vitest-environment jsdom

import { basicSetup } from 'codemirror';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodeMirrorCommandTarget } from './codemirror-command-target';

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

function createView(doc = 'INT. ROOM - DAY\n\nMAYA\nHello there.') {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [basicSetup] }),
  });
  return view;
}

describe('createCodeMirrorCommandTarget', () => {
  it('supports selection replacement, deletion, and undo/redo', () => {
    const editor = createView('MAYA speaks.');
    const target = createCodeMirrorCommandTarget(editor);
    editor.dispatch({ selection: EditorSelection.single(0, 4) });

    expect(target.selectedText()).toBe('MAYA');
    expect(target.replaceSelection('ADA')).toBe(true);
    expect(editor.state.doc.toString()).toBe('ADA speaks.');
    expect(target.undo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('MAYA speaks.');
    expect(target.redo()).toBe(true);
    expect(editor.state.doc.toString()).toBe('ADA speaks.');

    editor.dispatch({ selection: EditorSelection.single(0, 3) });
    expect(target.deleteSelection()).toBe(true);
    expect(editor.state.doc.toString()).toBe(' speaks.');
    expect(target.deleteSelection()).toBe(false);
  });

  it('applies editor accessibility and display settings', () => {
    const editor = createView();
    const target = createCodeMirrorCommandTarget(editor);

    target.setGrammarCheck(false);
    target.setZoomPercent(125);
    target.setFontSizePx(18);

    expect(editor.contentDOM.spellcheck).toBe(false);
    expect(editor.contentDOM.getAttribute('autocorrect')).toBe('off');
    expect(editor.dom.dataset.zoomPercent).toBe('125');
    expect(editor.dom.dataset.fontSizePx).toBe('18');
    expect(editor.dom.style.getPropertyValue('--screenplay-effective-font-size')).toBe('22.5px');
    expect(editor.contentDOM.style.fontSize).toBe('');
  });

  it('configures and executes find and replace commands', () => {
    const editor = createView('MAYA enters. MAYA exits.');
    const target = createCodeMirrorCommandTarget(editor);

    target.setSearch({ query: 'MAYA', replacement: 'ADA', matchCase: true });
    expect(target.findNext()).toBe(true);
    expect(target.selectedText()).toBe('MAYA');
    expect(target.replaceNext()).toBe(true);
    expect(editor.state.doc.toString()).toBe('ADA enters. MAYA exits.');
    expect(target.replaceAll()).toBe(true);
    expect(editor.state.doc.toString()).toBe('ADA enters. ADA exits.');
  });
});
