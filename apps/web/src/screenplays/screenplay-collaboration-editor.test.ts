// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createCodeMirrorCommandTarget } from './codemirror-command-target';
import {
  screenplayCollaborationExtensions,
  type ScreenplayCollaborationBinding,
} from './screenplay-collaboration-editor';
import { screenplayCollaborationText } from './screenplay-collaboration-text';

const views: EditorView[] = [];
const docs: Y.Doc[] = [];
const undoManagers: Y.UndoManager[] = [];
const awarenessInstances: Awareness[] = [];

function binding(doc: Y.Doc): ScreenplayCollaborationBinding {
  const text = doc.getText('source');
  const undoManager = new Y.UndoManager(text);
  const awareness = new Awareness(doc);
  undoManagers.push(undoManager);
  awarenessInstances.push(awareness);
  return { awareness, text, undoManager, isApplyingExternalUpdate: () => false };
}

function editor(collaboration: ScreenplayCollaborationBinding): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: screenplayCollaborationText(collaboration.text),
      extensions: screenplayCollaborationExtensions(collaboration),
    }),
  });
  views.push(view);
  return view;
}

function replicatedDocuments(initialText: string): [Y.Doc, Y.Doc] {
  const seed = new Y.Doc();
  seed.getText('source').insert(0, initialText);
  const encoded = Y.encodeStateAsUpdate(seed);
  seed.destroy();
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  Y.applyUpdate(alice, encoded);
  Y.applyUpdate(bob, encoded);
  docs.push(alice, bob);
  const networkOrigin = {};
  alice.on('update', (update, origin) => {
    if (origin !== networkOrigin) Y.applyUpdate(bob, update, networkOrigin);
  });
  bob.on('update', (update, origin) => {
    if (origin !== networkOrigin) Y.applyUpdate(alice, update, networkOrigin);
  });
  return [alice, bob];
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const undoManager of undoManagers.splice(0)) undoManager.destroy();
  for (const awareness of awarenessInstances.splice(0)) awareness.destroy();
  for (const doc of docs.splice(0)) doc.destroy();
  document.body.replaceChildren();
});

describe('collaborative editor undo and redo', () => {
  it("undoes only the invoking user's edit through menu commands and keybindings", () => {
    const [aliceDoc, bobDoc] = replicatedDocuments('FADE IN:\n');
    const alice = editor(binding(aliceDoc));
    const bob = editor(binding(bobDoc));

    alice.dispatch({ changes: { from: alice.state.doc.length, insert: 'ALICE\n' } });
    bob.dispatch({ changes: { from: 0, insert: 'BOB\n' } });
    expect(alice.state.doc.toString()).toBe(bob.state.doc.toString());

    const aliceCommands = createCodeMirrorCommandTarget(alice);
    expect(aliceCommands.undo()).toBe(true);

    expect(alice.state.doc.toString()).toContain('BOB');
    expect(alice.state.doc.toString()).not.toContain('ALICE');
    expect(bob.state.doc.toString()).toBe(alice.state.doc.toString());

    fireEvent.keyDown(alice.contentDOM, { key: 'y', code: 'KeyY', ctrlKey: true });

    expect(alice.state.doc.toString()).toContain('BOB');
    expect(alice.state.doc.toString()).toContain('ALICE');
    expect(bob.state.doc.toString()).toBe(alice.state.doc.toString());
  });
});
