import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { RealtimeInvalidation } from '@coda/contracts';
import type { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import { hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

function cookies(header = ''): Record<string, string> {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('=').map(decodeURIComponent))
      .filter((pair) => pair.length === 2) as Array<[string, string]>,
  );
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env().APP_ORIGIN).origin;
  } catch {
    return false;
  }
}

@Injectable()
@WebSocketGateway({ cors: false })
export class RealtimeGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket): Promise<void> {
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

  @SubscribeMessage('join-project')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() projectId: string,
  ): Promise<{ joined: boolean }> {
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

  private async emitToAuthorizedMembers(event: RealtimeInvalidation): Promise<void> {
    if (!this.server) return;
    const room = `project:${event.projectId}`;
    const sockets = await this.server.in(room).fetchSockets();
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
