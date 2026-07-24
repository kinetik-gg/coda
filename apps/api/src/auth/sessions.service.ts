import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';

const sessionSelect = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  userAgentClass: true,
} satisfies Prisma.SessionSelect;

export interface SessionListEntry {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgentClass: string | null;
  isCurrent: boolean;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(userId: string, currentSessionId: string | undefined): Promise<SessionListEntry[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: sessionSelect,
    });
    return sessions.map((session) => ({ ...session, isCurrent: session.id === currentSessionId }));
  }

  async revoke(userId: string, sessionId: string): Promise<{ revoked: true }> {
    const result = await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    if (!result.count) throw new NotFoundException('Session not found');
    await this.realtime.disconnectSession(sessionId);
    return { revoked: true };
  }

  async signOutEverywhere(
    userId: string,
    currentSessionId: string | undefined,
    keepCurrent: boolean,
  ): Promise<{ signedOut: number }> {
    const where: Prisma.SessionWhereInput = {
      userId,
      ...(keepCurrent && currentSessionId ? { id: { not: currentSessionId } } : {}),
    };
    const targets = await this.prisma.session.findMany({ where, select: { id: true } });
    if (!targets.length) return { signedOut: 0 };
    const ids = targets.map((target) => target.id);
    await this.prisma.session.deleteMany({ where: { id: { in: ids } } });
    await Promise.all(ids.map((id) => this.realtime.disconnectSession(id)));
    return { signedOut: ids.length };
  }
}
