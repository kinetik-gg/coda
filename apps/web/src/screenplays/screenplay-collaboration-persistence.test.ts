import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDocument } from 'y-indexeddb';
import {
  ScreenplayCollaborationSession,
  type ScreenplayCollaborationSessionOptions,
} from './screenplay-collaboration-session';

const sessions: ScreenplayCollaborationSession[] = [];
const databases: string[] = [];

function disconnectedSocket() {
  const socket = {
    connected: false,
    connect: () => socket,
    disconnect: () => socket,
    on: () => socket,
    off: () => socket,
    emit: () => socket,
  };
  return socket;
}

function createOfflineSession(screenplayId: string): ScreenplayCollaborationSession {
  const options: ScreenplayCollaborationSessionOptions = {
    socketFactory: () => disconnectedSocket() as never,
  };
  const session = new ScreenplayCollaborationSession(screenplayId, options);
  sessions.push(session);
  return session;
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()));
  await Promise.all(databases.splice(0).map((name) => clearDocument(name)));
  vi.unstubAllGlobals();
});

describe('ScreenplayCollaborationSession IndexedDB recovery', () => {
  it('reopens locally persisted CRDT edits without a network connection', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const screenplayId = `offline-${crypto.randomUUID()}`;
    databases.push(`coda-screenplay-collab:${screenplayId}`);
    const first = createOfflineSession(screenplayId);
    await first.whenLocalReady();

    first.text.insert(0, 'INT. WORKSHOP - NIGHT\n\nOffline draft.');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await first.destroy();
    sessions.splice(sessions.indexOf(first), 1);

    const recovered = createOfflineSession(screenplayId);
    await recovered.whenLocalReady();

    expect(recovered.getText()).toBe('INT. WORKSHOP - NIGHT\n\nOffline draft.');
    expect(recovered.getSaveState()).toBe('offline');
  });
});
