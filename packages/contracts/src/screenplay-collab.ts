import type { ScreenplayPermission } from './screenplay-permissions';

/**
 * Screenplay live-collaboration gateway wire protocol (ADR:
 * docs/adr-collaboration-engine-and-transport.md). The gateway carries opaque Yjs bytes as
 * `Uint8Array`; socket.io encodes binary attachments natively, so these types describe the JSON
 * envelope around the CRDT payload, not the CRDT format itself.
 */
export const SCREENPLAY_COLLAB_EVENTS = {
  join: 'join-screenplay',
  update: 'screenplay-update',
  awareness: 'screenplay-awareness',
  presenceDrop: 'screenplay-presence-drop',
} as const;

/**
 * Server -> client: this socket's cached permissions for a screenplay may be stale (a
 * membership/role change, an ownership transfer, or the screenplay being trashed) and it must
 * re-run `join-screenplay` before relying on read/write access again.
 */
export const SCREENPLAY_ACCESS_CHANGED_EVENT = 'screenplay-access-changed';

export interface JoinScreenplayRequest {
  screenplayId: string;
  /** The client's Yjs state vector; empty for a brand-new local document. */
  stateVector: Uint8Array;
}

export interface JoinScreenplayAccepted {
  status: 200;
  permissions: ScreenplayPermission[];
  identity: { userId: string; displayName: string };
  /** Everything the server has that the client's state vector says it is missing. */
  update: Uint8Array;
  serverStateVector: Uint8Array;
}

/**
 * A non-member and a trashed screenplay are indistinguishable — tenant isolation, never `403`,
 * which would confirm the screenplay exists.
 */
export interface JoinScreenplayRejected {
  status: 404;
}

export type JoinScreenplayAck = JoinScreenplayAccepted | JoinScreenplayRejected;

export interface ScreenplayUpdateRequest {
  screenplayId: string;
  update: Uint8Array;
}

export interface ScreenplayUpdateAccepted {
  status: 200;
  seq: number;
}

/** A read-only member's socket stays in the room; only the publish attempt is refused. */
export interface ScreenplayUpdateForbidden {
  status: 403;
  message: string;
}

export interface ScreenplayUpdateRejected {
  status: 404;
}

export type ScreenplayUpdateAck =
  ScreenplayUpdateAccepted | ScreenplayUpdateForbidden | ScreenplayUpdateRejected;

export interface ScreenplayAwarenessMessage {
  screenplayId: string;
  /** Opaque y-protocols/awareness encoding; the gateway relays without decoding it. */
  update: Uint8Array;
}

export interface ScreenplayPresenceDrop {
  userId: string;
}

export interface ScreenplayAccessChanged {
  screenplayId: string;
}
