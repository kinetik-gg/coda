// @vitest-environment jsdom

import {
  SCREENPLAY_COLLAB_EVENTS,
  type JoinScreenplayAccepted,
  type ScreenplayCollabFlushAccepted,
  type ScreenplayUpdateAccepted,
} from '@coda/contracts';
import type { Socket } from 'socket.io-client';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collaborationIdentity,
  ScreenplayCollaborationProvider,
} from './screenplay-collaboration-provider';
import { yTextContent } from './y-text-content';

type Handler = (...values: unknown[]) => void;
type AckHandler = (payload: unknown) => unknown;

class FakeSocket {
  connected = false;
  disconnectCalls = 0;
  readonly handlers = new Map<string, Set<Handler>>();
  readonly acknowledgements = new Map<string, AckHandler>();
  readonly outbound: Array<{ event: string; payload: unknown }> = [];

  on(event: string, handler: Handler): this {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  connect(): this {
    this.connected = true;
    this.trigger('connect');
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    if (!this.connected) return this;
    this.connected = false;
    this.trigger('disconnect');
    return this;
  }

  emit(event: string, payload: unknown): this {
    this.outbound.push({ event, payload });
    return this;
  }

  emitWithAck(event: string, payload: unknown): Promise<unknown> {
    this.outbound.push({ event, payload });
    const handler = this.acknowledgements.get(event);
    if (!handler) throw new Error(`Missing acknowledgement for ${event}`);
    return Promise.resolve(handler(payload));
  }

  trigger(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

interface Harness {
  provider: ScreenplayCollaborationProvider;
  serverDoc: Y.Doc;
  socket: FakeSocket;
  published: Uint8Array[];
}

const providers: ScreenplayCollaborationProvider[] = [];
const docs: Y.Doc[] = [];

afterEach(() => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const doc of docs.splice(0)) doc.destroy();
  vi.useRealTimers();
});

function harness(sourceText = 'FADE IN:\n'): Harness {
  const serverDoc = new Y.Doc();
  serverDoc.getText('source').insert(0, sourceText);
  docs.push(serverDoc);
  const socket = new FakeSocket();
  const published: Uint8Array[] = [];
  socket.acknowledgements.set(
    SCREENPLAY_COLLAB_EVENTS.join,
    () =>
      ({
        status: 200,
        permissions: ['read_screenplay', 'edit_screenplay'],
        identity: { userId: 'user-ada', displayName: 'Ada' },
        update: Y.encodeStateAsUpdate(serverDoc),
        serverStateVector: Y.encodeStateVector(serverDoc),
      }) satisfies JoinScreenplayAccepted,
  );
  socket.acknowledgements.set(SCREENPLAY_COLLAB_EVENTS.update, (payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('Expected update payload');
    const update = Reflect.get(payload, 'update') as unknown;
    if (!(update instanceof Uint8Array)) throw new Error('Expected binary update');
    published.push(update);
    Y.applyUpdate(serverDoc, update);
    return { status: 200, seq: published.length + 1 } satisfies ScreenplayUpdateAccepted;
  });
  socket.acknowledgements.set(
    SCREENPLAY_COLLAB_EVENTS.flush,
    () => ({ status: 200, version: 9 }) satisfies ScreenplayCollabFlushAccepted,
  );
  const provider = new ScreenplayCollaborationProvider(
    'screenplay-id',
    socket as unknown as Socket,
    3,
  );
  providers.push(provider);
  return { provider, serverDoc, socket, published };
}

async function start(harness: Harness): Promise<void> {
  harness.provider.start();
  await vi.waitFor(() => expect(harness.provider.snapshot.status).toBe('saved'));
}

describe('ScreenplayCollaborationProvider document synchronization', () => {
  it('keeps the in-flight socket alive across React StrictMode effect replay', async () => {
    vi.useFakeTimers();
    const target = harness();

    target.provider.start();
    target.provider.stop();
    target.provider.start();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(target.socket.disconnectCalls).toBe(0);
    expect(target.provider.snapshot.status).toBe('saved');
    expect(target.provider.snapshot.draft).toBe('FADE IN:\n');
  });

  it('joins from an empty Y.Doc and publishes the server-authorized local identity', async () => {
    const target = harness();

    await start(target);

    expect(target.provider.snapshot.draft).toBe('FADE IN:\n');
    expect(target.provider.snapshot.permissions).toEqual(['read_screenplay', 'edit_screenplay']);
    expect(target.provider.snapshot.participants).toEqual([
      expect.objectContaining({
        userId: 'user-ada',
        displayName: 'Ada',
        isLocal: true,
      }),
    ]);
    expect(
      target.socket.outbound.some(({ event }) => event === SCREENPLAY_COLLAB_EVENTS.awareness),
    ).toBe(true);
  });

  it('coalesces local CodeMirror transactions on the 100 ms transport boundary', async () => {
    const target = harness();
    await start(target);
    vi.useFakeTimers();

    target.provider.yText.insert(target.provider.yText.length, 'INT. ROOM - DAY\n');
    target.provider.yText.insert(target.provider.yText.length, 'Action.\n');

    expect(target.provider.snapshot.status).toBe('saving');
    await vi.advanceTimersByTimeAsync(99);
    expect(target.published).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(target.published).toHaveLength(1);
    expect(yTextContent(target.serverDoc.getText('source'))).toBe(
      'FADE IN:\nINT. ROOM - DAY\nAction.\n',
    );
    expect(target.provider.snapshot.status).toBe('saved');
  });

  it('applies a peer update without echoing it back to the server', async () => {
    const target = harness();
    await start(target);
    vi.useFakeTimers();
    const peer = new Y.Doc();
    docs.push(peer);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(target.serverDoc));
    const before = Y.encodeStateVector(peer);
    peer.getText('source').insert(peer.getText('source').length, 'REMOTE\n');

    target.socket.trigger(SCREENPLAY_COLLAB_EVENTS.update, {
      update: Y.encodeStateAsUpdate(peer, before),
    });
    await vi.advanceTimersByTimeAsync(150);

    expect(target.provider.snapshot.draft).toBe('FADE IN:\nREMOTE\n');
    expect(target.published).toHaveLength(0);
    expect(target.provider.snapshot.status).toBe('saved');
  });

  it('flushes pending text and adopts the projected version before continuing', async () => {
    const target = harness();
    await start(target);
    target.provider.yText.insert(target.provider.yText.length, 'SAVE ME\n');

    await expect(target.provider.persist()).resolves.toBe(true);

    expect(target.published).toHaveLength(1);
    expect(target.provider.snapshot.version).toBe(9);
    expect(target.provider.snapshot.status).toBe('saved');
    const events = target.socket.outbound.map(({ event }) => event);
    expect(events.at(-1)).toBe(SCREENPLAY_COLLAB_EVENTS.flush);
  });
});

describe('ScreenplayCollaborationProvider presence', () => {
  it('responds once when a previously unseen peer advertises awareness', async () => {
    const target = harness();
    await start(target);
    const peerDoc = new Y.Doc();
    docs.push(peerDoc);
    const peerAwareness = new Awareness(peerDoc);
    peerAwareness.setLocalStateField('user', collaborationIdentity('user-bob', 'Bob'));
    const awarenessBefore = target.socket.outbound.filter(
      ({ event }) => event === SCREENPLAY_COLLAB_EVENTS.awareness,
    ).length;

    target.socket.trigger(SCREENPLAY_COLLAB_EVENTS.awareness, {
      update: encodeAwarenessUpdate(peerAwareness, [peerDoc.clientID]),
    });

    expect(target.provider.snapshot.participants).toEqual([
      expect.objectContaining({ displayName: 'Ada', isLocal: true }),
      expect.objectContaining({ displayName: 'Bob', isLocal: false }),
    ]);
    const awarenessAfter = target.socket.outbound.filter(
      ({ event }) => event === SCREENPLAY_COLLAB_EVENTS.awareness,
    ).length;
    expect(awarenessAfter - awarenessBefore).toBe(1);
    peerAwareness.destroy();
  });

  it('drops stale remote chips and reports offline when the transport closes', async () => {
    const target = harness();
    await start(target);
    const peerDoc = new Y.Doc();
    docs.push(peerDoc);
    const peerAwareness = new Awareness(peerDoc);
    peerAwareness.setLocalStateField('user', collaborationIdentity('user-bob', 'Bob'));
    target.socket.trigger(SCREENPLAY_COLLAB_EVENTS.awareness, {
      update: encodeAwarenessUpdate(peerAwareness, [peerDoc.clientID]),
    });

    target.socket.disconnect();

    expect(target.provider.snapshot.status).toBe('offline');
    expect(target.provider.snapshot.participants).toEqual([
      expect.objectContaining({ displayName: 'Ada', isLocal: true }),
    ]);
    peerAwareness.destroy();
  });
});
