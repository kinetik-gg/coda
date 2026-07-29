import type {
  JoinScreenplayAck,
  JoinScreenplayRequest,
  ScreenplayAccessChanged,
  ScreenplayUpdateAck,
  ScreenplayUpdateRequest,
} from '@coda/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  ScreenplayCollaborationSession,
  screenplayCollaborationSocketOptions,
  type ScreenplayCollaborationSessionOptions,
} from './screenplay-collaboration-session';
import { screenplayCollaborationText } from './screenplay-collaboration-text';

type ConnectListener = () => void;
type DisconnectListener = () => void;
type ConnectErrorListener = () => void;
type UpdateListener = (message: { update: Uint8Array }) => void;
type AccessChangedListener = (message: ScreenplayAccessChanged) => void;

class FakeCollaborationServer {
  readonly doc = new Y.Doc();
  readonly sockets = new Set<FakeCollaborationSocket>();
  updateCount = 0;

  createSocket(): FakeCollaborationSocket {
    const socket = new FakeCollaborationSocket(this);
    this.sockets.add(socket);
    return socket;
  }

  join(
    request: JoinScreenplayRequest,
    acknowledge: (acknowledgement: JoinScreenplayAck) => void,
  ): void {
    acknowledge({
      status: 200,
      permissions: ['read_screenplay', 'edit_screenplay'],
      identity: { userId: 'user-id', displayName: 'Writer' },
      update: Y.encodeStateAsUpdate(this.doc, request.stateVector),
      serverStateVector: Y.encodeStateVector(this.doc),
    });
  }

  publish(
    sender: FakeCollaborationSocket,
    request: ScreenplayUpdateRequest,
    acknowledge: (acknowledgement: ScreenplayUpdateAck) => void,
  ): void {
    this.updateCount += 1;
    Y.applyUpdate(this.doc, request.update);
    for (const socket of this.sockets) {
      if (socket !== sender && socket.connected) socket.receiveUpdate(request.update);
    }
    acknowledge({ status: 200, seq: this.updateCount });
  }
}

class FakeCollaborationSocket {
  connected = false;
  private connectListener?: ConnectListener;
  private disconnectListener?: DisconnectListener;
  private connectErrorListener?: ConnectErrorListener;
  private updateListener?: UpdateListener;
  private accessChangedListener?: AccessChangedListener;

  constructor(private readonly server: FakeCollaborationServer) {}

  connect(): this {
    this.connected = true;
    this.connectListener?.();
    return this;
  }

  disconnect(): this {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.disconnectListener?.();
    return this;
  }

  drop(): void {
    this.disconnect();
  }

  on(event: string, listener: unknown): this {
    if (event === 'connect') this.connectListener = listener as ConnectListener;
    if (event === 'disconnect') this.disconnectListener = listener as DisconnectListener;
    if (event === 'connect_error') this.connectErrorListener = listener as ConnectErrorListener;
    if (event === 'screenplay-update') this.updateListener = listener as UpdateListener;
    if (event === 'screenplay-access-changed') {
      this.accessChangedListener = listener as AccessChangedListener;
    }
    return this;
  }

  off(event: string, listener: unknown): this {
    if (event === 'connect' && this.connectListener === listener) this.connectListener = undefined;
    if (event === 'disconnect' && this.disconnectListener === listener) {
      this.disconnectListener = undefined;
    }
    if (event === 'connect_error' && this.connectErrorListener === listener) {
      this.connectErrorListener = undefined;
    }
    if (event === 'screenplay-update' && this.updateListener === listener) {
      this.updateListener = undefined;
    }
    if (event === 'screenplay-access-changed' && this.accessChangedListener === listener) {
      this.accessChangedListener = undefined;
    }
    return this;
  }

  emit(event: string, request: unknown, acknowledge?: unknown): this {
    if (event === 'join-screenplay') {
      this.server.join(
        request as JoinScreenplayRequest,
        acknowledge as (value: JoinScreenplayAck) => void,
      );
    }
    if (event === 'screenplay-update') {
      this.server.publish(
        this,
        request as ScreenplayUpdateRequest,
        acknowledge as (value: ScreenplayUpdateAck) => void,
      );
    }
    return this;
  }

  receiveUpdate(update: Uint8Array): void {
    this.updateListener?.({ update });
  }
}

const sessions: ScreenplayCollaborationSession[] = [];

describe('screenplay collaboration transport', () => {
  it('uses an origin-bearing WebSocket handshake with bounded reconnect backoff', () => {
    expect(screenplayCollaborationSocketOptions).toMatchObject({
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      transports: ['websocket'],
      withCredentials: true,
    });
  });
});

function sessionOptions(socket: FakeCollaborationSocket): ScreenplayCollaborationSessionOptions {
  return {
    flushDelayMs: 20,
    socketFactory: () => socket as never,
    persistenceFactory: () => ({
      whenSynced: Promise.resolve(),
      destroy: () => Promise.resolve(),
    }),
  };
}

function createSession(
  screenplayId: string,
  server: FakeCollaborationServer,
): { session: ScreenplayCollaborationSession; socket: FakeCollaborationSocket } {
  const socket = server.createSocket();
  const session = new ScreenplayCollaborationSession(screenplayId, sessionOptions(socket));
  sessions.push(session);
  return { session, socket };
}

async function runFlushTimer(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()));
  vi.useRealTimers();
});

describe('ScreenplayCollaborationSession synchronization', () => {
  it('loads the server document and coalesces local edits into one durable frame', async () => {
    const server = new FakeCollaborationServer();
    server.doc.getText('source').insert(0, 'FADE IN:');
    const { session } = createSession('screenplay-1', server);

    await session.whenLocalReady();
    expect(session.getText()).toBe('FADE IN:');
    expect(session.getSaveState()).toBe('saved');

    session.text.insert(session.text.length, '\n');
    session.text.insert(session.text.length, 'INT. ROOM - DAY');

    expect(session.getSaveState()).toBe('saving');
    await runFlushTimer();

    expect(server.updateCount).toBe(1);
    expect(screenplayCollaborationText(server.doc.getText('source'))).toBe(
      'FADE IN:\nINT. ROOM - DAY',
    );
    expect(session.getSaveState()).toBe('saved');
  });

  it('keeps offline edits and converges both clients after reconnect', async () => {
    const server = new FakeCollaborationServer();
    server.doc.getText('source').insert(0, 'FADE IN:');
    const alice = createSession('screenplay-2', server);
    const bob = createSession('screenplay-2', server);
    await Promise.all([alice.session.whenLocalReady(), bob.session.whenLocalReady()]);

    alice.socket.drop();
    alice.session.text.insert(alice.session.text.length, '\nALICE');
    bob.session.text.insert(0, 'BOB\n');
    await runFlushTimer();

    expect(alice.session.getSaveState()).toBe('offline');
    expect(alice.session.getText()).toContain('ALICE');
    expect(bob.session.getText()).not.toContain('ALICE');

    alice.socket.connect();
    await runFlushTimer();

    const serverText = screenplayCollaborationText(server.doc.getText('source'));
    expect(alice.session.getText()).toBe(serverText);
    expect(bob.session.getText()).toBe(serverText);
    expect(serverText).toContain('BOB');
    expect(serverText).toContain('ALICE');
    expect(alice.session.getSaveState()).toBe('saved');
  });
});
