import { Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  SCREENPLAY_ACCESS_CHANGED_EVENT,
  SCREENPLAY_COLLAB_EVENTS,
  type ScreenplayCollabFlushAck,
  type ScreenplayCollabFlushRequest,
  type ScreenplayCollabProjection,
  type JoinScreenplayAck,
  type JoinScreenplayRequest,
  type RealtimeInvalidation,
  type ScreenplayAwarenessMessage,
  type ScreenplayPermission,
  type ScreenplayUpdateAck,
  type ScreenplayUpdateRequest,
} from '@coda/contracts';
import type { Server, Socket } from 'socket.io';
import { isBrowserOriginAllowed } from '../config/browser-origin';
import { env } from '../config/env';
import { runtimeCapabilities } from '../config/runtime-capabilities';
import { hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayCollabLogService } from '../screenplays/collab/screenplay-collab-log.service';
import { ScreenplayCollabProjectionService } from '../screenplays/collab/screenplay-collab-projection.service';
import { screenplayCollabRoom } from '../screenplays/collab/screenplay-collab.constants';

function cookies(header = ''): Record<string, string> {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('=').map(decodeURIComponent))
      .filter((pair) => pair.length === 2) as Array<[string, string]>,
  );
}

function allowedOrigin(origin: string | undefined): boolean {
  return isBrowserOriginAllowed(origin, env());
}

/** Normalizes a socket.io binary payload (Buffer, ArrayBuffer, or array-like) to a Uint8Array. */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array();
}

type ScreenplayAccessCache = Map<string, Set<ScreenplayPermission>>;
type ScreenplayAwarenessClients = Map<string, number>;

/** The subset of `Socket` a fetched remote socket also structurally satisfies. */
type CollabSocket = Pick<Socket, 'data' | 'leave' | 'emit'>;

function screenplayAccessCache(socket: Pick<Socket, 'data'>): ScreenplayAccessCache {
  const existing = Reflect.get(socket.data as object, 'screenplayAccess') as
    ScreenplayAccessCache | undefined;
  if (existing) return existing;
  const created: ScreenplayAccessCache = new Map();
  Reflect.set(socket.data as object, 'screenplayAccess', created);
  return created;
}

function screenplayAwarenessClients(socket: Pick<Socket, 'data'>): ScreenplayAwarenessClients {
  const existing = Reflect.get(socket.data as object, 'screenplayAwarenessClients') as
    ScreenplayAwarenessClients | undefined;
  if (existing) return existing;
  const created: ScreenplayAwarenessClients = new Map();
  Reflect.set(socket.data as object, 'screenplayAwarenessClients', created);
  return created;
}

@Injectable()
@WebSocketGateway({ cors: false })
export class RealtimeGateway implements OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly projectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly collabLog: ScreenplayCollabLogService,
    private readonly collabProjection?: ScreenplayCollabProjectionService,
  ) {}

  /**
   * `handleConnection` is invoked as soon as the transport connects, but nothing about socket.io
   * or Nest's gateway wiring guarantees this async hook *completes* — and therefore that
   * `socket.data.userId` is set — before the client's first message is dispatched to a
   * `@SubscribeMessage` handler. The authentication work itself is synchronously wrapped in a
   * promise stashed on `socket.data` before any `await`, so every handler below can `await
   * connectionReady(socket)` and see a settled, authoritative result instead of racing this
   * lifecycle hook.
   */
  async handleConnection(socket: Socket): Promise<void> {
    const ready = this.authenticate(socket);
    Reflect.set(socket.data as object, 'ready', ready);
    await ready;
  }

  private async authenticate(socket: Socket): Promise<void> {
    const origin = socket.handshake.headers.origin;
    if (!allowedOrigin(origin)) {
      socket.disconnect(true);
      return;
    }
    const token = cookies(socket.handshake.headers.cookie)[env().SESSION_COOKIE_NAME];
    if (!token) {
      socket.disconnect(true);
      return;
    }
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      socket.disconnect(true);
      return;
    }
    Reflect.set(socket.data as object, 'userId', session.userId);
    Reflect.set(socket.data as object, 'sessionId', session.id);
  }

  /** Waits for `handleConnection`'s authentication to settle, if it has not already. */
  private async connectionReady(socket: Socket): Promise<void> {
    const ready = Reflect.get(socket.data as object, 'ready') as Promise<void> | undefined;
    if (ready) await ready;
  }

  @SubscribeMessage('join-project')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() projectId: string,
  ): Promise<{ joined: boolean }> {
    await this.connectionReady(socket);
    const userId = Reflect.get(socket.data as object, 'userId') as unknown;
    const sessionId = Reflect.get(socket.data as object, 'sessionId') as unknown;
    if (typeof userId !== 'string' || typeof sessionId !== 'string') return { joined: false };
    const [membership, session] = await Promise.all([
      this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: { user: { select: { status: true } } },
      }),
      this.prisma.session.findFirst({
        where: { id: sessionId, userId, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
        select: { id: true },
      }),
    ]);
    if (!membership || membership.user.status !== 'ACTIVE' || !session) return { joined: false };
    await socket.join(`project:${projectId}`);
    return { joined: true };
  }

  /**
   * Screenplay live-collaboration channel (ADR: docs/adr-collaboration-engine-and-transport.md,
   * Decision 2). Authorization is attached at exactly two points, both resolving through
   * `ScreenplayPermissionService` (via {@link ScreenplayCollabLogService}) so there is one
   * authorization code path: here at join (`read_screenplay`), and in {@link screenplayUpdate}
   * against the permission set this join call caches (`edit_screenplay`).
   */
  @SubscribeMessage(SCREENPLAY_COLLAB_EVENTS.join)
  async joinScreenplay(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: JoinScreenplayRequest,
  ): Promise<JoinScreenplayAck> {
    await this.connectionReady(socket);
    const userId = Reflect.get(socket.data as object, 'userId') as unknown;
    if (typeof userId !== 'string' || typeof body?.screenplayId !== 'string') {
      return { status: 404 };
    }
    let identity;
    try {
      identity = await this.collabLog.assertJoin(userId, body.screenplayId);
    } catch (error) {
      if (error instanceof NotFoundException) return { status: 404 };
      throw error;
    }
    await this.collabLog.ensureBootstrapped(body.screenplayId);
    const sync = await this.collabLog.loadSyncState(
      body.screenplayId,
      toUint8Array(body.stateVector),
    );
    await socket.join(screenplayCollabRoom(body.screenplayId));
    screenplayAccessCache(socket).set(body.screenplayId, new Set(identity.permissions));
    return {
      status: 200,
      permissions: identity.permissions,
      identity: { userId: identity.userId, displayName: identity.displayName },
      update: sync.update,
      serverStateVector: sync.serverStateVector,
    };
  }

  /**
   * Publishes one coalesced Yjs update. Authorization reads the permission set
   * {@link joinScreenplay} cached on `socket.data` rather than re-querying the database on every
   * publish (the ADR's left-open item 1: implement the eviction signal first — see
   * {@link evictScreenplayMember} / {@link evictScreenplay} — and adopt per-publish
   * re-assertion only if that proves leaky). A read-only member's socket is not dropped on `403`;
   * it keeps receiving updates.
   */
  @SubscribeMessage(SCREENPLAY_COLLAB_EVENTS.update)
  async screenplayUpdate(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ScreenplayUpdateRequest,
  ): Promise<ScreenplayUpdateAck> {
    await this.connectionReady(socket);
    const userId = Reflect.get(socket.data as object, 'userId') as unknown;
    if (typeof userId !== 'string' || typeof body?.screenplayId !== 'string') {
      return { status: 404 };
    }
    const permissions = screenplayAccessCache(socket).get(body.screenplayId);
    if (!permissions) return { status: 404 };
    if (!permissions.has('edit_screenplay')) {
      return { status: 403, message: 'Missing permission: edit_screenplay' };
    }
    const update = toUint8Array(body.update);
    const seq = await this.collabLog.appendUpdate(body.screenplayId, userId, socket.id, update);
    socket.to(screenplayCollabRoom(body.screenplayId)).emit(SCREENPLAY_COLLAB_EVENTS.update, {
      update: body.update,
    });
    this.scheduleProjection(body.screenplayId);
    return { status: 200, seq };
  }

  /**
   * Forces the append-only log into `Screenplay.sourceText` before Save/navigation/export
   * continues. Ordinary typing uses the debounced path below; this acknowledgement is the
   * compatibility seam for workflows that require a canonical immutable snapshot immediately.
   */
  @SubscribeMessage(SCREENPLAY_COLLAB_EVENTS.flush)
  async flushScreenplayCollaboration(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ScreenplayCollabFlushRequest,
  ): Promise<ScreenplayCollabFlushAck> {
    await this.connectionReady(socket);
    if (
      typeof body?.screenplayId !== 'string' ||
      !screenplayAccessCache(socket).has(body.screenplayId)
    ) {
      return { status: 404 };
    }
    this.clearProjectionTimer(body.screenplayId);
    const version = await this.projectSource(body.screenplayId);
    if (version === undefined) return { status: 404 };
    this.broadcastProjection({ screenplayId: body.screenplayId, version });
    return { status: 200, version };
  }

  /**
   * Relays a y-protocols/awareness update to the rest of the room. Never persisted (Decision 4) and
   * never acknowledged (relay-only per the wire protocol); a socket that has not joined this
   * screenplay is silently ignored rather than told anything about it.
   */
  @SubscribeMessage(SCREENPLAY_COLLAB_EVENTS.awareness)
  screenplayAwareness(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ScreenplayAwarenessMessage,
  ): void {
    if (typeof body?.screenplayId !== 'string') return;
    if (!Number.isSafeInteger(body.clientId) || body.clientId < 0) return;
    if (!screenplayAccessCache(socket).has(body.screenplayId)) return;
    screenplayAwarenessClients(socket).set(body.screenplayId, body.clientId);
    socket.to(screenplayCollabRoom(body.screenplayId)).emit(SCREENPLAY_COLLAB_EVENTS.awareness, {
      clientId: body.clientId,
      update: toUint8Array(body.update),
    });
  }

  /** Lets every screenplay room this socket was in know the collaborator dropped (Decision 4). */
  handleDisconnect(socket: Socket): void {
    const userId = Reflect.get(socket.data as object, 'userId') as unknown;
    if (typeof userId !== 'string') return;
    const cache = Reflect.get(socket.data as object, 'screenplayAccess') as
      ScreenplayAccessCache | undefined;
    if (!cache) return;
    const awarenessClients = Reflect.get(socket.data as object, 'screenplayAwarenessClients') as
      ScreenplayAwarenessClients | undefined;
    for (const screenplayId of cache.keys()) {
      const clientId = awarenessClients?.get(screenplayId);
      if (clientId === undefined) continue;
      socket.to(screenplayCollabRoom(screenplayId)).emit(SCREENPLAY_COLLAB_EVENTS.presenceDrop, {
        userId,
        clientId,
      });
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.projectionTimers.values()) clearTimeout(timer);
    this.projectionTimers.clear();
  }

  /**
   * The eviction signal (ADR left-open item 1): forces every socket belonging to `userId` out of a
   * screenplay's room and drops its cached permission set, so a stale `join-screenplay` grant can
   * never authorize another publish. Called by `ScreenplayAccessService` whenever a membership or
   * role change could have affected this user's access. Best-effort like `invalidateProject`: a
   * delivery failure here must never fail the REST mutation that triggered it.
   */
  async evictScreenplayMember(screenplayId: string, userId: string): Promise<void> {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(screenplayCollabRoom(screenplayId)).fetchSockets();
      for (const socket of sockets) {
        if (Reflect.get(socket.data as object, 'userId') === userId) {
          this.forgetScreenplayAccess(socket, screenplayId);
        }
      }
    } catch (error) {
      this.logger.error(
        `Unable to evict user ${userId} from screenplay ${screenplayId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Like {@link evictScreenplayMember}, but for every current member — used when trashing. */
  async evictScreenplay(screenplayId: string): Promise<void> {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(screenplayCollabRoom(screenplayId)).fetchSockets();
      for (const socket of sockets) this.forgetScreenplayAccess(socket, screenplayId);
    } catch (error) {
      this.logger.error(
        `Unable to evict screenplay ${screenplayId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private forgetScreenplayAccess(socket: CollabSocket, screenplayId: string): void {
    const cache = Reflect.get(socket.data as object, 'screenplayAccess') as
      ScreenplayAccessCache | undefined;
    cache?.delete(screenplayId);
    void socket.leave(screenplayCollabRoom(screenplayId));
    socket.emit(SCREENPLAY_ACCESS_CHANGED_EVENT, { screenplayId });
  }

  private scheduleProjection(screenplayId: string): void {
    this.clearProjectionTimer(screenplayId);
    this.projectionTimers.set(
      screenplayId,
      setTimeout(() => {
        this.projectionTimers.delete(screenplayId);
        void this.projectAndBroadcast(screenplayId);
      }, 700),
    );
  }

  private clearProjectionTimer(screenplayId: string): void {
    const timer = this.projectionTimers.get(screenplayId);
    if (timer !== undefined) clearTimeout(timer);
    this.projectionTimers.delete(screenplayId);
  }

  private async projectAndBroadcast(screenplayId: string): Promise<void> {
    try {
      const version = await this.projectSource(screenplayId);
      if (version !== undefined) this.broadcastProjection({ screenplayId, version });
    } catch (error) {
      this.logger.error(
        `Unable to project collaborative screenplay ${screenplayId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private projectSource(screenplayId: string): Promise<number | undefined> {
    return this.collabProjection
      ? this.collabProjection.project(screenplayId)
      : this.collabLog.materializeSourceText(screenplayId);
  }

  private broadcastProjection(projection: ScreenplayCollabProjection): void {
    this.server
      ?.in(screenplayCollabRoom(projection.screenplayId))
      .emit(SCREENPLAY_COLLAB_EVENTS.projected, projection);
  }

  private async emitToAuthorizedMembers(event: RealtimeInvalidation): Promise<void> {
    if (!this.server) return;
    const room = `project:${event.projectId}`;
    const sockets = await this.server.in(room).fetchSockets();
    // Single-user desktop: the sole owner is the only member and already passed the join-time
    // membership check, so deliver directly and skip the multi-user re-authorization queries.
    if (runtimeCapabilities().realtimeFanout === 'single-user') {
      for (const socket of sockets) socket.emit('invalidate', event);
      return;
    }
    const socketUsers = sockets
      .map((socket) => ({
        socket,
        userId: Reflect.get(socket.data as object, 'userId') as unknown,
        sessionId: Reflect.get(socket.data as object, 'sessionId') as unknown,
      }))
      .filter(
        (entry): entry is { socket: (typeof sockets)[number]; userId: string; sessionId: string } =>
          typeof entry.userId === 'string' && typeof entry.sessionId === 'string',
      );
    const [authorized, sessions] = await Promise.all([
      this.prisma.projectMembership.findMany({
        where: {
          projectId: event.projectId,
          userId: { in: socketUsers.map(({ userId }) => userId) },
          user: { status: 'ACTIVE' },
        },
        select: { userId: true },
      }),
      this.prisma.session.findMany({
        where: {
          id: { in: socketUsers.map(({ sessionId }) => sessionId) },
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE' },
        },
        select: { id: true, userId: true },
      }),
    ]);
    const authorizedIds = new Set(authorized.map(({ userId }) => userId));
    const activeSessions = new Map(sessions.map(({ id, userId }) => [id, userId]));
    for (const { socket, userId, sessionId } of socketUsers) {
      if (activeSessions.get(sessionId) !== userId) {
        socket.disconnect(true);
        continue;
      }
      if (authorizedIds.has(userId)) {
        socket.emit('invalidate', event);
        continue;
      }
      socket.leave(room);
    }
  }

  async disconnectSession(sessionId: string): Promise<void> {
    if (!this.server) return;
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      if (Reflect.get(socket.data as object, 'sessionId') === sessionId) socket.disconnect(true);
    }
  }

  /**
   * Resolve the authoritative revision after the caller's mutation commits, then
   * notify only sockets that previously passed the membership check for this project.
   * Realtime delivery is best-effort and must never turn a committed REST mutation
   * into a failed response.
   */
  async invalidateProject(projectId: string, resource: string, ids: string[]): Promise<void> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { revision: true },
      });
      if (!project) return;
      await this.emitToAuthorizedMembers({ projectId, resource, ids, revision: project.revision });
    } catch (error) {
      this.logger.error(
        `Unable to emit invalidation for project ${projectId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
