import {
  SCREENPLAY_ACCESS_CHANGED_EVENT,
  SCREENPLAY_COLLAB_EVENTS,
  type JoinScreenplayAck,
  type ScreenplayAccessChanged,
  type ScreenplayCollabFlushAck,
  type ScreenplayCollabProjection,
  type ScreenplayPermission,
  type ScreenplayPresenceDrop,
  type ScreenplayUpdateAck,
} from '@coda/contracts';
import type { Socket } from 'socket.io-client';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { SaveState } from '../workspace/shell';
import { yTextContent } from './y-text-content';

const COLLAB_TEXT_KEY = 'source';
const UPDATE_DEBOUNCE_MS = 100;
const STRICT_MODE_DISCONNECT_GRACE_MS = 250;

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

interface CollaborationIdentity {
  userId: string;
  displayName: string;
  name: string;
  color: string;
  colorLight: string;
}

export interface ScreenplayCollaborator {
  clientId: number;
  userId: string;
  displayName: string;
  color: string;
  isLocal: boolean;
}

export interface ScreenplayCollaborationSnapshot {
  awareness: Awareness;
  draft: string;
  permissions: readonly ScreenplayPermission[];
  participants: readonly ScreenplayCollaborator[];
  remoteOrigin: object;
  status: SaveState;
  version: number;
  yText: Y.Text;
}

function binary(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array();
}

function paletteIndex(userId: string): number {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % collaboratorColors.length;
}

export function collaborationIdentity(userId: string, displayName: string): CollaborationIdentity {
  const colors = collaboratorColors[paletteIndex(userId)]!;
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
  const name = Reflect.get(user, 'name') as unknown;
  const colorLight = Reflect.get(user, 'colorLight') as unknown;
  return {
    userId,
    displayName,
    name: typeof name === 'string' ? name : displayName,
    color,
    colorLight: typeof colorLight === 'string' ? colorLight : color,
  };
}

function hasContent(update: Uint8Array): boolean {
  return Y.encodeStateVectorFromUpdate(update).length > 1;
}

/**
 * One screenplay-scoped Yjs document and socket.io transport shared by every mounted editor pane.
 * The provider deliberately contains no IndexedDB or per-user undo behavior; those are issue #156.
 */
export class ScreenplayCollaborationProvider {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly yText = this.doc.getText(COLLAB_TEXT_KEY);
  readonly remoteOrigin = Object.freeze({ source: 'screenplay-collaboration-remote' });

  private readonly remoteAwarenessOrigin = Object.freeze({ source: 'remote-awareness' });
  private readonly listeners = new Set<() => void>();
  private readonly pendingUpdates: Uint8Array[] = [];
  private disconnectTimer: number | undefined;
  private flushTimer: number | undefined;
  private joined = false;
  private started = false;
  private publishFlight: Promise<boolean> | undefined;
  private snapshotValue: ScreenplayCollaborationSnapshot;

  constructor(
    readonly screenplayId: string,
    private readonly socket: Socket,
    initialVersion: number,
  ) {
    this.snapshotValue = {
      awareness: this.awareness,
      draft: '',
      permissions: [],
      participants: [],
      remoteOrigin: this.remoteOrigin,
      status: socket.connected ? 'loading' : 'offline',
      version: initialVersion,
      yText: this.yText,
    };
    this.doc.on('update', this.handleDocumentUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);
    this.awareness.on('change', this.refreshParticipants);
  }

  get snapshot(): ScreenplayCollaborationSnapshot {
    return this.snapshotValue;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.disconnectTimer !== undefined) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.awareness, this.handleRemoteAwareness);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.presenceDrop, this.handlePresenceDrop);
    this.socket.on(SCREENPLAY_COLLAB_EVENTS.projected, this.handleProjection);
    this.socket.on(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    if (this.socket.connected) void this.join();
    else this.socket.connect();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.update, this.handleRemoteUpdate);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.awareness, this.handleRemoteAwareness);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.presenceDrop, this.handlePresenceDrop);
    this.socket.off(SCREENPLAY_COLLAB_EVENTS.projected, this.handleProjection);
    this.socket.off(SCREENPLAY_ACCESS_CHANGED_EVENT, this.handleAccessChanged);
    this.joined = false;
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = undefined;
      if (!this.started) this.socket.disconnect();
    }, STRICT_MODE_DISCONNECT_GRACE_MS);
  }

  destroy(): void {
    this.stop();
    if (this.disconnectTimer !== undefined) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    this.socket.disconnect();
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  replaceSourceText(value: string): void {
    this.doc.transact(() => {
      this.yText.delete(0, this.yText.length);
      this.yText.insert(0, value);
    });
  }

  adoptVersion(version: number): void {
    if (Number.isInteger(version) && version > 0) this.setSnapshot({ version });
  }

  async persist(): Promise<boolean> {
    if (!(await this.flushPending())) return false;
    this.setSnapshot({ status: 'saving' });
    const ack = (await this.socket.emitWithAck(SCREENPLAY_COLLAB_EVENTS.flush, {
      screenplayId: this.screenplayId,
    })) as ScreenplayCollabFlushAck;
    if (ack.status !== 200) {
      this.setSnapshot({ status: this.socket.connected ? 'failed' : 'offline' });
      return false;
    }
    this.setSnapshot({ status: 'saved', version: ack.version });
    return true;
  }

  private readonly handleConnect = (): void => {
    void this.join();
  };

  private readonly handleDisconnect = (): void => {
    this.joined = false;
    this.removeRemoteAwareness();
    this.setSnapshot({ status: 'offline' });
  };

  private async join(): Promise<void> {
    this.setSnapshot({ status: this.yText.length > 0 ? 'saving' : 'loading' });
    const ack = (await this.socket.emitWithAck(SCREENPLAY_COLLAB_EVENTS.join, {
      screenplayId: this.screenplayId,
      stateVector: Y.encodeStateVector(this.doc),
    })) as JoinScreenplayAck;
    if (ack.status !== 200) {
      this.setSnapshot({ status: 'failed' });
      return;
    }
    Y.applyUpdate(this.doc, binary(ack.update), this.remoteOrigin);
    this.joined = true;
    this.pendingUpdates.splice(0);
    const missing = Y.encodeStateAsUpdate(this.doc, binary(ack.serverStateVector));
    if (hasContent(missing) && !(await this.publishUpdate(missing))) return;
    const identity = collaborationIdentity(ack.identity.userId, ack.identity.displayName);
    this.awareness.setLocalStateField('user', identity);
    this.setSnapshot({ permissions: ack.permissions, status: 'saved' });
    await this.flushPending();
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    this.setSnapshot({ draft: yTextContent(this.yText) });
    if (origin === this.remoteOrigin) return;
    this.pendingUpdates.push(update);
    this.setSnapshot({ status: this.socket.connected ? 'saving' : 'offline' });
    this.scheduleFlush();
  };

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushPending();
    }, UPDATE_DEBOUNCE_MS);
  }

  private async flushPending(): Promise<boolean> {
    if (this.publishFlight) {
      const published = await this.publishFlight;
      return published && (this.pendingUpdates.length === 0 || this.flushPending());
    }
    if (!this.socket.connected || !this.joined) {
      this.setSnapshot({ status: 'offline' });
      return false;
    }
    if (this.pendingUpdates.length === 0) return true;
    const update = Y.mergeUpdates(this.pendingUpdates.splice(0));
    this.publishFlight = this.publishUpdate(update);
    const published = await this.publishFlight;
    this.publishFlight = undefined;
    if (!published) this.pendingUpdates.unshift(update);
    if (published && this.pendingUpdates.length > 0) return this.flushPending();
    if (published) this.setSnapshot({ status: 'saved' });
    return published;
  }

  private async publishUpdate(update: Uint8Array): Promise<boolean> {
    const ack = (await this.socket.emitWithAck(SCREENPLAY_COLLAB_EVENTS.update, {
      screenplayId: this.screenplayId,
      update,
    })) as ScreenplayUpdateAck;
    if (ack.status === 200) return true;
    this.setSnapshot({ status: this.socket.connected ? 'failed' : 'offline' });
    return false;
  }

  private readonly handleRemoteUpdate = (message: unknown): void => {
    if (!message || typeof message !== 'object') return;
    const update = binary(Reflect.get(message, 'update'));
    if (update.length > 0) Y.applyUpdate(this.doc, update, this.remoteOrigin);
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
      update: encodeAwarenessUpdate(this.awareness, clients),
    });
  };

  private readonly handleRemoteAwareness = (message: unknown): void => {
    if (!message || typeof message !== 'object') return;
    const before = new Set(this.awareness.getStates().keys());
    applyAwarenessUpdate(
      this.awareness,
      binary(Reflect.get(message, 'update')),
      this.remoteAwarenessOrigin,
    );
    const gainedPeer = [...this.awareness.getStates().keys()].some(
      (clientId) => clientId !== this.doc.clientID && !before.has(clientId),
    );
    if (gainedPeer && this.awareness.getLocalState()) {
      this.socket.emit(SCREENPLAY_COLLAB_EVENTS.awareness, {
        screenplayId: this.screenplayId,
        update: encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
      });
    }
  };

  private readonly handlePresenceDrop = (message: ScreenplayPresenceDrop): void => {
    if (typeof message?.userId !== 'string') return;
    const clientIds = [...this.awareness.getStates()]
      .filter(
        ([clientId, state]) =>
          clientId !== this.doc.clientID && identityFromState(state)?.userId === message.userId,
      )
      .map(([clientId]) => clientId);
    removeAwarenessStates(this.awareness, clientIds, this.remoteAwarenessOrigin);
  };

  private readonly handleProjection = (message: ScreenplayCollabProjection): void => {
    if (message?.screenplayId !== this.screenplayId || !Number.isInteger(message.version)) return;
    this.setSnapshot({ version: message.version });
  };

  private readonly handleAccessChanged = (message: ScreenplayAccessChanged): void => {
    if (message?.screenplayId !== this.screenplayId) return;
    this.joined = false;
    this.setSnapshot({ permissions: [], status: 'failed' });
  };

  private readonly refreshParticipants = (): void => {
    const participants = [...this.awareness.getStates()]
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
    this.setSnapshot({ participants });
  };

  private removeRemoteAwareness(): void {
    removeAwarenessStates(
      this.awareness,
      [...this.awareness.getStates().keys()].filter((clientId) => clientId !== this.doc.clientID),
      this.remoteAwarenessOrigin,
    );
  }

  private setSnapshot(update: Partial<ScreenplayCollaborationSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...update };
    for (const listener of this.listeners) listener();
  }
}
