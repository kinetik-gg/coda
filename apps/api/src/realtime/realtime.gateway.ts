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

@Injectable()
@WebSocketGateway({ cors: false })
export class RealtimeGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(socket: Socket): Promise<void> {
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
  }

  @SubscribeMessage('join-project')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() projectId: string,
  ): Promise<{ joined: boolean }> {
    const userId = Reflect.get(socket.data as object, 'userId') as unknown;
    if (typeof userId !== 'string') return { joined: false };
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!membership) return { joined: false };
    await socket.join(`project:${projectId}`);
    return { joined: true };
  }

  invalidate(event: RealtimeInvalidation): void {
    this.server?.to(`project:${event.projectId}`).emit('invalidate', event);
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
      this.invalidate({ projectId, resource, ids, revision: project.revision });
    } catch (error) {
      this.logger.error(
        `Unable to emit invalidation for project ${projectId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
