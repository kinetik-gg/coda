import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SessionsService } from './sessions.service';

const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '10000000-0000-4000-8000-000000000099';
const sessionId = '10000000-0000-4000-8000-000000000002';

function serviceWith(overrides: {
  findMany?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    session: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
      deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const realtime = { disconnectSession: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new SessionsService(prisma as never, realtime as never),
    prisma,
    realtime,
  };
}

describe('SessionsService', () => {
  it('lists only the caller sessions, marking the current one and excluding token material', async () => {
    const now = new Date();
    const findMany = vi.fn().mockResolvedValue([
      { id: sessionId, createdAt: now, lastSeenAt: now, userAgentClass: 'Chrome on macOS' },
      { id: 'session-2', createdAt: now, lastSeenAt: now, userAgentClass: null },
    ]);
    const { service, prisma } = serviceWith({ findMany });

    const result = await service.list(userId, sessionId);

    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, expiresAt: { gt: expect.any(Date) as Date } } }),
    );
    expect(result).toEqual([
      {
        id: sessionId,
        createdAt: now,
        lastSeenAt: now,
        userAgentClass: 'Chrome on macOS',
        isCurrent: true,
      },
      { id: 'session-2', createdAt: now, lastSeenAt: now, userAgentClass: null, isCurrent: false },
    ]);
    for (const entry of result) {
      expect(entry).not.toHaveProperty('tokenHash');
    }
  });

  it('revokes a session owned by the caller and disconnects its realtime sockets', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service, prisma, realtime } = serviceWith({ deleteMany });

    await expect(service.revoke(userId, sessionId)).resolves.toEqual({ revoked: true });

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: sessionId, userId },
    });
    expect(realtime.disconnectSession).toHaveBeenCalledWith(sessionId);
  });

  it('reports 404, not 403, when the session belongs to another user', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const { service, realtime } = serviceWith({ deleteMany });

    await expect(service.revoke(otherUserId, sessionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.disconnectSession).not.toHaveBeenCalled();
  });

  it('reports 404 for a session id that does not exist at all', async () => {
    const { service } = serviceWith({ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) });

    await expect(service.revoke(userId, 'missing-session')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('signs out every other session while keeping the current one by default', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'session-2' }, { id: 'session-3' }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const { service, prisma, realtime } = serviceWith({ findMany, deleteMany });

    const result = await service.signOutEverywhere(userId, sessionId, true);

    expect(result).toEqual({ signedOut: 2 });
    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId, id: { not: sessionId } },
      select: { id: true },
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-2', 'session-3'] } },
    });
    expect(realtime.disconnectSession).toHaveBeenCalledWith('session-2');
    expect(realtime.disconnectSession).toHaveBeenCalledWith('session-3');
  });

  it('signs out the current session too when keepCurrent is false', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: sessionId }]);
    const { service, prisma } = serviceWith({
      findMany,
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    });

    await service.signOutEverywhere(userId, sessionId, false);

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId },
      select: { id: true },
    });
  });

  it('short-circuits without deleting when there is nothing to revoke', async () => {
    const { service, prisma } = serviceWith({ findMany: vi.fn().mockResolvedValue([]) });

    await expect(service.signOutEverywhere(userId, sessionId, true)).resolves.toEqual({
      signedOut: 0,
    });
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });
});
