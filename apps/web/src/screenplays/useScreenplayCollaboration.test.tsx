// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type {
  JoinScreenplayAck,
  JoinScreenplayRequest,
  ScreenplayUpdateAck,
} from '@coda/contracts';
import {
  SCREENPLAY_COLLAB_TEXT_KEY,
  screenplayCollaborationText,
} from './screenplay-collaboration-text';
import { useScreenplayCollaboration } from './useScreenplayCollaboration';

const SOURCE_TEXT = 'INT. WAREHOUSE - NIGHT\n\nThe crate is already open.\n';

/**
 * The narrow slice of the collaboration socket this hook's lifecycle exercises: connect, the join
 * handshake, and the publish acknowledgement its replay frame waits on.
 */
class FakeCollaborationSocket {
  connected = false;
  private readonly listeners = new Map<string, (payload: never) => void>();

  constructor(private readonly doc: Y.Doc) {}

  on(event: string, listener: (payload: never) => void): this {
    this.listeners.set(event, listener);
    return this;
  }

  off(event: string, listener: (payload: never) => void): this {
    if (this.listeners.get(event) === listener) this.listeners.delete(event);
    return this;
  }

  connect(): this {
    this.connected = true;
    (this.listeners.get('connect') as (() => void) | undefined)?.();
    return this;
  }

  disconnect(): this {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) (this.listeners.get('disconnect') as (() => void) | undefined)?.();
    return this;
  }

  emit(event: string, request: unknown, acknowledge?: unknown): this {
    if (event === 'join-screenplay') {
      (acknowledge as (value: JoinScreenplayAck) => void)({
        status: 200,
        permissions: ['read_screenplay', 'edit_screenplay'],
        identity: { userId: 'user-id', displayName: 'Writer' },
        update: Y.encodeStateAsUpdate(this.doc, (request as JoinScreenplayRequest).stateVector),
        serverStateVector: Y.encodeStateVector(this.doc),
      });
    }
    if (event === 'screenplay-update') {
      (acknowledge as (value: ScreenplayUpdateAck) => void)({ status: 200, seq: 1 });
    }
    return this;
  }
}

function collaborationFixture() {
  const doc = new Y.Doc();
  doc.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, SOURCE_TEXT);
  const sockets: FakeCollaborationSocket[] = [];
  const options = {
    socketFactory: () => {
      const socket = new FakeCollaborationSocket(doc);
      sockets.push(socket);
      return socket as never;
    },
    persistenceFactory: () => ({
      whenSynced: Promise.resolve(),
      destroy: () => Promise.resolve(),
    }),
  };
  return { options, sockets };
}

function strictMode({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe('useScreenplayCollaboration', () => {
  // Regression (#336): Strict Mode mounts every effect, tears it down, and mounts it again. The
  // hook used to keep the session its own cleanup had destroyed, so the editor bound to an empty,
  // permanently disconnected Y.Doc and rendered a blank document over a loaded screenplay.
  it('serves the collaborative document after React remounts the hook', async () => {
    const { options } = collaborationFixture();
    const { result } = renderHook(() => useScreenplayCollaboration('screenplay-336', options), {
      wrapper: strictMode,
    });

    await waitFor(() => {
      expect(result.current.contentReady).toBe(true);
    });
    expect(result.current.text).toBe(SOURCE_TEXT);
    expect(screenplayCollaborationText(result.current.binding.text)).toBe(SOURCE_TEXT);
    expect(result.current.saveState).toBe('saved');
  });

  it('leaves exactly one connected socket behind and closes it on unmount', async () => {
    const { options, sockets } = collaborationFixture();
    const { result, unmount } = renderHook(
      () => useScreenplayCollaboration('screenplay-336', options),
      { wrapper: strictMode },
    );

    await waitFor(() => {
      expect(result.current.contentReady).toBe(true);
    });
    expect(sockets.filter((socket) => socket.connected)).toHaveLength(1);

    unmount();
    await waitFor(() => {
      expect(sockets.filter((socket) => socket.connected)).toHaveLength(0);
    });
  });
});
