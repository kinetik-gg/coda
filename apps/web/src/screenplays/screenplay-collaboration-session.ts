import {
  SCREENPLAY_ACCESS_CHANGED_EVENT,
  SCREENPLAY_COLLAB_EVENTS,
  type JoinScreenplayAck,
  type JoinScreenplayRequest,
  type ScreenplayAccessChanged,
  type ScreenplayUpdateAck,
  type ScreenplayUpdateRequest,
} from '@coda/contracts';
import { io, type Socket } from 'socket.io-client';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { SaveState } from '../workspace/shell';

const SCREENPLAY_COLLAB_TEXT_KEY = 'source';
const UPDATE_FLUSH_DELAY_MS = 100;
const RECONNECT_DELAY_MS = 500;
const RECONNECT_DELAY_MAX_MS = 10_000;
const EMPTY_UPDATE_LENGTH = Y.encodeStateAsUpdate(new Y.Doc()).byteLength;

interface ServerToClientEvents {
  'screenplay-update': (message: { update: Uint8Array }) => void;
  'screenplay-access-changed': (message: ScreenplayAccessChanged) => void;
}

interface ClientToServerEvents {
  'join-screenplay': (
    request: JoinScreenplayRequest,
    acknowledge: (acknowledgement: JoinScreenplayAck) => void,
  ) => void;
  'screenplay-update': (
    request: ScreenplayUpdateRequest,
    acknowledge: (acknowledgement: ScreenplayUpdateAck) => void,
  ) => void;
}

type CollaborationSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface CollaborationPersistence {
  whenSynced: Promise<unknown>;
  destroy(): Promise<void>;
}

export interface ScreenplayCollaborationSessionOptions {
  flushDelayMs?: number;
  socketFactory?: () => CollaborationSocket;
  persistenceFactory?: (name: string, doc: Y.Doc) => CollaborationPersistence;
}

export type ScreenplayCollaborationListener = () => void;

function createSocket(): CollaborationSocket {
  return io({
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
    randomizationFactor: 0.25,
    withCredentials: true,
  });
}

function createPersistence(name: string, doc: Y.Doc): CollaborationPersistence {
  return new IndexeddbPersistence(name, doc);
}

function hasPayload(update: Uint8Array): boolean {
  return update.byteLength > EMPTY_UPDATE_LENGTH;
}

/**
 * Owns the browser-local CRDT and its durable transport for one screenplay. The session is shared
 * by every mounted editor pane so IndexedDB, reconnect replay, and per-user undo all see one
 * document identity.
 */
export class ScreenplayCollaborationSession {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText(SCREENPLAY_COLLAB_TEXT_KEY);
  readonly undoManager = new Y.UndoManager(this.text);

  private readonly listeners = new Set<ScreenplayCollaborationListener>();
  private readonly socket: CollaborationSocket;
  private readonly persistence: CollaborationPersistence;
  private readonly remoteOrigin = {};
  private readonly flushDelayMs: number;
  private readonly localReady: Promise<void>;
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private publishInFlight = false;
  private joined = false;
  private destroyed = false;
  private saveState: SaveState = 'loading';

  constructor(
    readonly screenplayId: string,
    options: ScreenplayCollaborationSessionOptions = {},
  ) {
    this.flushDelayMs = options.flushDelayMs ?? UPDATE_FLUSH_DELAY_MS;
    this.socket = (options.socketFactory ?? createSocket)();
    this.persistence = (options.persistenceFactory ?? createPersistence)(
      `coda-screenplay-collab:${screenplayId}`,
      this.doc,
    );
    this.doc.on('update', this.handleDocumentUpdate);
    this.text.observe(this.notify);
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.on(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    globalThis.addEventListener?.('online', this.handleOnline);
    globalThis.addEventListener?.('offline', this.handleOffline);
    this.localReady = this.start();
  }

  getSaveState = (): SaveState => this.saveState;

  getText = (): string => this.text.toString();

  subscribe = (listener: ScreenplayCollaborationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  whenLocalReady(): Promise<void> {
    return this.localReady;
  }

  async flush(): Promise<boolean> {
    if (this.destroyed || !this.joined || !this.socket.connected) return false;
    this.clearFlushTimer();
    await this.publishPending();
    return this.saveState === 'saved';
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearFlushTimer();
    globalThis.removeEventListener?.('online', this.handleOnline);
    globalThis.removeEventListener?.('offline', this.handleOffline);
    this.doc.off('update', this.handleDocumentUpdate);
    this.text.unobserve(this.notify);
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('connect_error', this.handleConnectError);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.off(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    this.socket.disconnect();
    this.undoManager.destroy();
    await this.persistence.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  private async start(): Promise<void> {
    await this.persistence.whenSynced;
    if (this.destroyed) return;
    if (globalThis.navigator?.onLine === false) {
      this.setSaveState('offline');
      return;
    }
    this.setSaveState('saving');
    this.socket.connect();
  }

  private readonly notify = (): void => {
    for (const listener of this.listeners) listener();
  };

  private setSaveState(state: SaveState): void {
    if (this.saveState === state) return;
    this.saveState = state;
    this.notify();
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this.remoteOrigin || origin === this.persistence || this.destroyed) return;
    this.pendingUpdates.push(update);
    if (!this.joined || !this.socket.connected) {
      this.setSaveState('offline');
      return;
    }
    this.setSaveState('saving');
    this.scheduleFlush();
  };

  private readonly handleConnect = (): void => {
    this.setSaveState('saving');
    this.join();
  };

  private readonly handleDisconnect = (): void => {
    this.joined = false;
    this.setSaveState('offline');
  };

  private readonly handleConnectError = (): void => {
    this.joined = false;
    this.setSaveState('offline');
  };

  private readonly handleOnline = (): void => {
    if (this.destroyed || this.socket.connected) return;
    this.setSaveState('saving');
    this.socket.connect();
  };

  private readonly handleOffline = (): void => {
    this.joined = false;
    this.setSaveState('offline');
  };

  private readonly handleRemoteUpdate = ({ update }: { update: Uint8Array }): void => {
    Y.applyUpdate(this.doc, update, this.remoteOrigin);
  };

  private readonly handleAccessChanged = ({ screenplayId }: ScreenplayAccessChanged): void => {
    if (screenplayId !== this.screenplayId || !this.socket.connected) return;
    this.joined = false;
    this.setSaveState('saving');
    this.join();
  };

  private join(): void {
    const request: JoinScreenplayRequest = {
      screenplayId: this.screenplayId,
      stateVector: Y.encodeStateVector(this.doc),
    };
    this.socket.emit(SCREENPLAY_COLLAB_EVENTS.join, request, (acknowledgement) => {
      if (this.destroyed || !this.socket.connected) return;
      if (acknowledgement.status !== 200) {
        this.joined = false;
        this.setSaveState('failed');
        return;
      }
      Y.applyUpdate(this.doc, acknowledgement.update, this.remoteOrigin);
      const replay = Y.encodeStateAsUpdate(this.doc, acknowledgement.serverStateVector);
      this.joined = true;
      this.pendingUpdates = hasPayload(replay) ? [replay] : [];
      if (this.pendingUpdates.length > 0) {
        this.setSaveState('saving');
        void this.publishPending();
      } else {
        this.setSaveState('saved');
      }
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.publishInFlight) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.publishPending();
    }, this.flushDelayMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === undefined) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private async publishPending(): Promise<void> {
    if (
      this.publishInFlight ||
      this.pendingUpdates.length === 0 ||
      !this.joined ||
      !this.socket.connected
    ) {
      return;
    }
    this.publishInFlight = true;
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];
    const update = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
    const acknowledgement = await new Promise<ScreenplayUpdateAck>((resolve) => {
      this.socket.emit(
        SCREENPLAY_COLLAB_EVENTS.update,
        { screenplayId: this.screenplayId, update },
        resolve,
      );
    });
    this.publishInFlight = false;
    if (acknowledgement.status !== 200) {
      this.pendingUpdates = [update, ...this.pendingUpdates];
      this.setSaveState(acknowledgement.status === 403 ? 'failed' : 'offline');
      return;
    }
    if (this.pendingUpdates.length > 0) {
      this.setSaveState('saving');
      this.scheduleFlush();
      return;
    }
    this.setSaveState('saved');
  }
}
