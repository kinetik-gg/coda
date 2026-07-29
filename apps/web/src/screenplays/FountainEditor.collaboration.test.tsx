// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { FountainEditor } from './FountainEditor';
import type { FountainCollaborationBinding } from './fountain-collaboration-extension';
import { remoteCollaborationTransaction } from './fountain-syntax';
import { yTextContent } from './y-text-content';

interface TestBinding {
  awareness: Awareness;
  binding: FountainCollaborationBinding;
  doc: Y.Doc;
}

const resources: Array<{ awareness?: Awareness; doc: Y.Doc }> = [];

afterEach(() => {
  cleanup();
  for (const resource of resources.splice(0)) {
    resource.awareness?.destroy();
    resource.doc.destroy();
  }
});

function binding(source: string): TestBinding {
  const doc = new Y.Doc();
  const yText = doc.getText('source');
  yText.insert(0, source);
  const awareness = new Awareness(doc);
  const result = {
    awareness,
    binding: {
      awareness,
      remoteOrigin: Object.freeze({ source: 'remote-test-update' }),
      yText,
    },
    doc,
  };
  resources.push(result);
  return result;
}

function peerOf(source: TestBinding): { awareness: Awareness; doc: Y.Doc; yText: Y.Text } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source.doc));
  const awareness = new Awareness(doc);
  resources.push({ awareness, doc });
  return { awareness, doc, yText: doc.getText('source') };
}

describe('FountainEditor collaborative transactions', () => {
  it('annotates remote Yjs changes so scroll and typewriter consumers can ignore them', async () => {
    const collaboration = binding('FIRST\nSECOND');
    let view: EditorView | undefined;
    const remoteFlags: boolean[] = [];
    render(
      <FountainEditor
        collaboration={collaboration.binding}
        onSave={() => undefined}
        onReady={(next) => {
          view = next;
        }}
        typewriterScrollingEnabled
      />,
    );
    view?.dispatch({
      effects: StateEffect.appendConfig.of(
        // Record the annotation at the public extension boundary; consumers in FountainEditor and
        // fountain-syntax use this same signal to preserve local viewport intent.
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          remoteFlags.push(
            update.transactions.some(
              (transaction) => transaction.annotation(remoteCollaborationTransaction) === true,
            ),
          );
        }),
      ),
    });
    const peer = peerOf(collaboration);
    const before = Y.encodeStateVector(peer.doc);
    peer.yText.insert(peer.yText.length, '\nREMOTE');

    Y.applyUpdate(
      collaboration.doc,
      Y.encodeStateAsUpdate(peer.doc, before),
      collaboration.binding.remoteOrigin,
    );

    await waitFor(() => expect(view?.state.doc.toString()).toContain('REMOTE'));
    expect(remoteFlags).toEqual([true]);
  });

  it('auto-expands a collapsed boneyard so a remote cursor and selection stay visible', async () => {
    const hiddenText = `/* ${'hidden-revision '.repeat(24)}*/`;
    const collaboration = binding(`INT. ROOM - DAY\n\n${hiddenText}\n`);
    const result = render(
      <FountainEditor collaboration={collaboration.binding} onSave={() => undefined} />,
    );
    expect(result.getByRole('button', { name: /boneyard comment/i })).toBeInTheDocument();
    expect(result.container.querySelector('.cm-content')).not.toHaveTextContent('hidden-revision');
    const peer = peerOf(collaboration);
    const start = yTextContent(collaboration.binding.yText).indexOf('hidden-revision');
    peer.awareness.setLocalState({
      user: {
        userId: 'user-bob',
        displayName: 'Bob',
        name: 'Bob',
        color: 'var(--coda-danger)',
        colorLight: 'color-mix(in srgb, var(--coda-danger) 20%, transparent)',
      },
      cursor: {
        anchor: Y.createRelativePositionFromTypeIndex(peer.yText, start),
        head: Y.createRelativePositionFromTypeIndex(peer.yText, start + 6),
      },
    });

    applyAwarenessUpdate(
      collaboration.awareness,
      encodeAwarenessUpdate(peer.awareness, [peer.doc.clientID]),
      Object.freeze({ source: 'remote-awareness-test' }),
    );

    await waitFor(() =>
      expect(result.container.querySelector('.cm-content')).toHaveTextContent('hidden-revision'),
    );
    expect(result.container.querySelector('.cm-ySelection')).toBeInTheDocument();
    expect(result.container.querySelector('.cm-ySelectionCaret')).toHaveTextContent('Bob');
  });
});
