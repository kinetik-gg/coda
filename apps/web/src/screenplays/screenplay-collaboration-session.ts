import {
  SCREENPLAY_ACCESS_CHANGED_EVENT,
  SCREENPLAY_COLLAB_EVENTS,
  type JoinScreenplayAck,
  type JoinScreenplayRequest,
  type ScreenplayAccessChanged,
  type ScreenplayAwarenessMessage,
  type ScreenplayCollabFlushAck,
  type ScreenplayCollabProjection,
  type ScreenplayPresenceDrop,
  type ScreenplayUpdateAck,
  type ScreenplayUpdateRequest,
} from '@coda/contracts';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { SaveState } from '../workspace/shell';
import {
  SCREENPLAY_COLLAB_TEXT_KEY,
  screenplayCollaborationText,
} from './screenplay-collaboration-text';

const UPDATE_FLUSH_DELAY_MS = 100;
const RECONNECT_DELAY_MS = 500;
const RECONNECT_DELAY_MAX_MS = 10_000;
const EMPTY_UPDATE_LENGTH = Y.encodeStateAsUpdate(new Y.Doc()).byteLength;

interface ServerToClientEvents {
  'screenplay-update': (message: { update: Uint8Array }) => void;
  'screenplay-awareness': (message: { clientId: number; update: Uint8Array }) => void;
  'screenplay-presence-drop': (message: ScreenplayPresenceDrop) => void;
  'screenplay-collaboration-projected': (message: ScreenplayCollabProjection) => void;
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
  'screenplay-awareness': (request: ScreenplayAwarenessMessage) => void;
  'flush-screenplay-collaboration': (
    request: { screenplayId: string },
    acknowledge: (acknowledgement: ScreenplayCollabFlushAck) => void,
  ) => void;
}

type CollaborationSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const screenplayCollaborationSocketOptions = {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: RECONNECT_DELAY_MS,
  reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
  randomizationFactor: 0.25,
  transports: ['websocket'],
  withCredentials: true,
} satisfies Partial<ManagerOptions & SocketOptions>;

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

export interface ScreenplayCollaborator {
  clientId: number;
  userId: string;
  displayName: string;
  color: string;
  isLocal: boolean;
}

interface CollaborationIdentity {
  userId: string;
  displayName: string;
  name: string;
  color: string;
  colorLight: string;
}

const collaboratorColors = [
  {
    color: 'var(--coda-focus)',
    colorLight: 'color-mix(in srgb, var(--coda-focus) 22%, transparent)',
  },
  {
    color: 'var(--coda-success)',
    colorLight: 'color-mix(in srgb, var(--coda-success) 22%, transparent)',
  },
  {
    color: 'var(--coda-danger)',
    colorLight: 'color-mix(in srgb, var(--coda-danger) 20%, transparent)',
  },
  {
    color: 'var(--coda-selection)',
    colorLight: 'color-mix(in srgb, var(--coda-selection) 22%, transparent)',
  },
] as const;

function collaborationIdentity(userId: string, displayName: string): CollaborationIdentity {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  const colors = collaboratorColors[hash % collaboratorColors.length]!;
  const name = displayName.trim() || 'Collaborator';
  return { userId, displayName: name, name, ...colors };
}

function identityFromState(state: unknown): CollaborationIdentity | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const user = Reflect.get(state, 'user') as unknown;
  if (!user || typeof user !== 'object') return undefined;
  const userId = Reflect.get(user, 'userId') as unknown;
  const displayName = Reflect.get(user, 'displayName') as unknown;
  const color = Reflect.get(user, 'color') as unknown;
  if (typeof userId !== 'string' || typeof displayName !== 'string' || typeof color !== 'string') {
    return undefined;
  }
  const colorLight = Reflect.get(user, 'colorLight') as unknown;
  return {
    userId,
    displayName,
    name: displayName,
    color,
    colorLight: typeof colorLight === 'string' ? colorLight : color,
  };
}

function createSocket(): CollaborationSocket {
  // The gateway rejects originless handshakes. Chromium omits Origin on same-origin Engine.IO
  // polling GETs, while its WebSocket handshake includes both Origin and the session cookie.
  return io(screenplayCollaborationSocketOptions);
}

function createPersistence(name: string, doc: Y.Doc): CollaborationPersistence {
  return new IndexeddbPersistence(name, doc);
}

function hasPayload(update: Uint8Array): boolean {
  return update.byteLength > EMPTY_UPDATE_LENGTH;
}

/** Socket.IO's browser client materializes binary attachments as ArrayBuffer, despite wire types. */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array();
}

/**
 * Owns the browser-local CRDT and its durable transport for one screenplay. The session is shared
 * by every mounted editor pane so IndexedDB, reconnect replay, and per-user undo all see one
 * document identity.
 */
export class ScreenplayCollaborationSession {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly text = this.doc.getText(SCREENPLAY_COLLAB_TEXT_KEY);
  readonly undoManager = new Y.UndoManager(this.text);

  private readonly listeners = new Set<ScreenplayCollaborationListener>();
  private readonly socket: CollaborationSocket;
  private readonly persistence: CollaborationPersistence;
  private readonly remoteOrigin = {};
  private readonly remoteAwarenessOrigin = {};
  private readonly flushDelayMs: number;
  private readonly localReady: Promise<void>;
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private inFlightUpdate: Uint8Array | undefined;
  private externalTransactionDepth = 0;
  private joined = false;
  private destroyed = false;
  private contentReady = false;
  private saveState: SaveState = 'loading';
  private participants: readonly ScreenplayCollaborator[] = [];
  private projectedVersion: number | undefined;

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
    this.doc.on('beforeTransaction', this.handleBeforeTransaction);
    this.doc.on('afterTransaction', this.handleAfterTransaction);
    this.doc.on('update', this.handleDocumentUpdate);
    this.text.observe(this.notify);
    this.awareness.on('update', this.handleAwarenessUpdate);
    this.awareness.on('change', this.refreshParticipants);
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.awareness, this.handleRemoteAwareness);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.presenceDrop, this.handlePresenceDrop);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.projected, this.handleProjection);
    this.socket.on(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    globalThis.addEventListener?.('online', this.handleOnline);
    globalThis.addEventListener?.('offline', this.handleOffline);
    this.localReady = this.start();
  }

  getSaveState = (): SaveState => this.saveState;

  /**
   * Whether the session currently has a joined, live socket it could flush against right now.
   * `flush()` already no-ops when this is false; callers that gate leaving a document on a
   * successful flush use this to tell "the flush attempt failed" apart from "there was never a
   * connection to flush through", since only the former should hold the writer in place (#337).
   */
  isConnected = (): boolean => this.joined && this.socket.connected;

  /**
   * A destroyed session is inert forever: its socket is closed, its `Y.Doc` is gone, and its
   * save state is frozen wherever {@link destroy} left it. Owners that can outlive one mount —
   * React's development remount, above all — must be able to tell that apart from a session that
   * is merely still connecting (#336).
   */
  isDestroyed = (): boolean => this.destroyed;

  getText = (): string => screenplayCollaborationText(this.text);

  getContentReady = (): boolean => this.contentReady;

  getParticipants = (): readonly ScreenplayCollaborator[] => this.participants;

  getProjectedVersion = (): number | undefined => this.projectedVersion;

  private readonly refreshParticipants = (): void => {
    this.participants = [...this.awareness.getStates()]
      .flatMap(([clientId, state]) => {
        const identity = identityFromState(state);
        return identity
          ? [
              {
                clientId,
                userId: identity.userId,
                displayName: identity.displayName,
                color: identity.color,
                isLocal: clientId === this.doc.clientID,
              },
            ]
          : [];
      })
      .sort((left, right) => Number(right.isLocal) - Number(left.isLocal));
    this.notify();
  };

  isApplyingExternalUpdate = (): boolean => this.externalTransactionDepth > 0;

  subscribe = (listener: ScreenplayCollaborationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  whenLocalReady(): Promise<void> {
    return this.localReady;
  }

  replaceText = (value: string): void => {
    if (value === this.getText()) return;
    this.doc.transact(() => {
      this.text.delete(0, this.text.length);
      this.text.insert(0, value);
    }, this);
  };

  async flush(): Promise<number | undefined> {
    if (this.destroyed || !this.joined || !this.socket.connected) return undefined;
    this.clearFlushTimer();
    await this.publishPending();
    if (this.saveState !== 'saved') return undefined;
    const acknowledgement = await new Promise<ScreenplayCollabFlushAck>((resolve) => {
      this.socket.emit(
        SCREENPLAY_COLLAB_EVENTS.flush,
        { screenplayId: this.screenplayId },
        resolve,
      );
    });
    if (acknowledgement.status !== 200) return undefined;
    this.adoptProjectedVersion(acknowledgement.version);
    return acknowledgement.version;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearFlushTimer();
    globalThis.removeEventListener?.('online', this.handleOnline);
    globalThis.removeEventListener?.('offline', this.handleOffline);
    this.doc.off('beforeTransaction', this.handleBeforeTransaction);
    this.doc.off('afterTransaction', this.handleAfterTransaction);
    this.doc.off('update', this.handleDocumentUpdate);
    this.text.unobserve(this.notify);
    this.awareness.off('update', this.handleAwarenessUpdate);
    this.awareness.off('change', this.refreshParticipants);
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('connect_error', this.handleConnectError);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.awareness, this.handleRemoteAwareness);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.presenceDrop, this.handlePresenceDrop);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.projected, this.handleProjection);
    this.socket.off(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    this.socket.disconnect();
    this.awareness.destroy();
    this.undoManager.destroy();
    await this.persistence.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  private async start(): Promise<void> {
    await this.persistence.whenSynced;
    if (this.destroyed) return;
    if (globalThis.navigator?.onLine === false) {
      this.markContentReady();
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

  private markContentReady(): void {
    if (this.contentReady) return;
    this.contentReady = true;
    this.notify();
  }

  private readonly handleBeforeTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin === this.remoteOrigin || transaction.origin === this.persistence) {
      this.externalTransactionDepth += 1;
    }
  };

  private readonly handleAfterTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin === this.remoteOrigin || transaction.origin === this.persistence) {
      this.externalTransactionDepth = Math.max(0, this.externalTransactionDepth - 1);
    }
  };

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
    this.restoreInFlightUpdate();
    this.joined = false;
    this.removeRemoteAwareness();
    this.setSaveState('offline');
  };

  private readonly handleConnectError = (): void => {
    this.restoreInFlightUpdate();
    this.joined = false;
    this.setSaveState('offline');
  };

  private readonly handleOnline = (): void => {
    if (this.destroyed || this.socket.connected) return;
    this.setSaveState('saving');
    this.socket.connect();
  };

  private readonly handleOffline = (): void => {
    this.restoreInFlightUpdate();
    this.joined = false;
    // The browser's offline event can arrive before Engine.IO notices that its WebSocket is dead.
    // Close that stale transport now so the matching online event can reconnect deterministically.
    if (this.socket.connected) this.socket.disconnect();
    this.setSaveState('offline');
  };

  private readonly handleRemoteUpdate = ({ update }: { update: Uint8Array }): void => {
    Y.applyUpdate(this.doc, toUint8Array(update), this.remoteOrigin);
  };

  private readonly handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this.remoteAwarenessOrigin || !this.socket.connected || !this.joined) return;
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length === 0) return;
    this.socket.emit(SCREENPLAY_COLLAB_EVENTS.awareness, {
      screenplayId: this.screenplayId,
      clientId: this.doc.clientID,
      update: encodeAwarenessUpdate(this.awareness, clients),
    });
  };

  private readonly handleRemoteAwareness = ({
    update,
  }: {
    clientId: number;
    update: Uint8Array;
  }): void => {
    const before = new Set(this.awareness.getStates().keys());
    applyAwarenessUpdate(this.awareness, toUint8Array(update), this.remoteAwarenessOrigin);
    const gainedPeer = [...this.awareness.getStates().keys()].some(
      (clientId) => clientId !== this.doc.clientID && !before.has(clientId),
    );
    if (gainedPeer && this.awareness.getLocalState()) {
      this.socket.emit(SCREENPLAY_COLLAB_EVENTS.awareness, {
        screenplayId: this.screenplayId,
        clientId: this.doc.clientID,
        update: encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
      });
    }
  };

  private readonly handlePresenceDrop = ({ userId, clientId }: ScreenplayPresenceDrop): void => {
    if (
      typeof userId !== 'string' ||
      !Number.isSafeInteger(clientId) ||
      clientId === this.doc.clientID
    ) {
      return;
    }
    const state = this.awareness.getStates().get(clientId);
    if (identityFromState(state)?.userId !== userId) return;
    removeAwarenessStates(this.awareness, [clientId], this.remoteAwarenessOrigin);
  };

  private readonly handleProjection = (projection: ScreenplayCollabProjection): void => {
    if (projection.screenplayId !== this.screenplayId) return;
    this.adoptProjectedVersion(projection.version);
  };

  private adoptProjectedVersion(version: number): void {
    if (!Number.isInteger(version) || version < 1 || this.projectedVersion === version) return;
    this.projectedVersion = version;
    this.notify();
  }

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
      Y.applyUpdate(this.doc, toUint8Array(acknowledgement.update), this.remoteOrigin);
      this.markContentReady();
      const replay = Y.encodeStateAsUpdate(
        this.doc,
        toUint8Array(acknowledgement.serverStateVector),
      );
      this.joined = true;
      this.awareness.setLocalStateField(
        'user',
        collaborationIdentity(
          acknowledgement.identity.userId,
          acknowledgement.identity.displayName,
        ),
      );
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
    if (this.flushTimer !== undefined || this.inFlightUpdate) return;
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

  private removeRemoteAwareness(): void {
    removeAwarenessStates(
      this.awareness,
      [...this.awareness.getStates().keys()].filter((clientId) => clientId !== this.doc.clientID),
      this.remoteAwarenessOrigin,
    );
  }

  private restoreInFlightUpdate(): void {
    if (!this.inFlightUpdate) return;
    this.pendingUpdates = [this.inFlightUpdate, ...this.pendingUpdates];
    this.inFlightUpdate = undefined;
  }

  private async publishPending(): Promise<void> {
    if (
      this.inFlightUpdate ||
      this.pendingUpdates.length === 0 ||
      !this.joined ||
      !this.socket.connected
    ) {
      return;
    }
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];
    const update = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
    this.inFlightUpdate = update;
    const acknowledgement = await new Promise<ScreenplayUpdateAck>((resolve) => {
      this.socket.emit(
        SCREENPLAY_COLLAB_EVENTS.update,
        { screenplayId: this.screenplayId, update },
        resolve,
      );
    });
    // A disconnect restores the frame to `pendingUpdates`; an acknowledgement from that abandoned
    // transport must not remove or duplicate the replay that the new connection owns.
    if (this.inFlightUpdate !== update) return;
    this.inFlightUpdate = undefined;
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
