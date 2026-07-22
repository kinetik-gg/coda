import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway';

beforeAll(() => {
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.S3_ENDPOINT ??= 'http://localhost:9000';
  process.env.S3_PUBLIC_ENDPOINT ??= 'http://localhost:9001';
  process.env.S3_BUCKET ??= 'test-bucket';
  process.env.S3_ACCESS_KEY ??= 'test';
  process.env.S3_SECRET_KEY ??= 'test-secret';
});

function socket(userId: string, sessionId: string) {
  return {
    data: { userId, sessionId },
    emit: vi.fn(),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
}

describe('RealtimeGateway continuous authorization', () => {
  it('emits only to active sessions that retain project membership', async () => {
    const active = socket('active-user', 'active-session');
    const removed = socket('removed-user', 'removed-session');
    const expired = socket('expired-user', 'expired-session');
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ revision: 7 }) },
      projectMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'active-user' }]),
      },
      session: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'active-session', userId: 'active-user' },
          { id: 'removed-session', userId: 'removed-user' },
        ]),
      },
    };
    const gateway = new RealtimeGateway(prisma as never);
    Reflect.set(gateway, 'server', {
      in: vi
        .fn()
        .mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([active, removed, expired]) }),
    });

    await gateway.invalidateProject('project', 'items', ['item']);

    expect(active.emit).toHaveBeenCalledWith('invalidate', {
      projectId: 'project',
      resource: 'items',
      ids: ['item'],
      revision: 7,
    });
    expect(removed.leave).toHaveBeenCalledWith('project:project');
    expect(expired.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects malformed or cross-origin handshakes before session lookup', async () => {
    const findUnique = vi.fn();
    const gateway = new RealtimeGateway({ session: { findUnique } } as never);
    const client = {
      handshake: { headers: { origin: 'not a valid origin', cookie: 'coda_session=value' } },
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing cookies and invalid sessions, then accepts an active same-origin session', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: 'ACTIVE' },
      });
    const gateway = new RealtimeGateway({ session: { findUnique } } as never);
    const noCookie = {
      data: {},
      handshake: { headers: { origin: 'http://localhost:3000' } },
      disconnect: vi.fn(),
    };
    await gateway.handleConnection(noCookie as never);
    expect(noCookie.disconnect).toHaveBeenCalledWith(true);

    const invalid = {
      data: {},
      handshake: {
        headers: { origin: 'http://localhost:3000', cookie: 'other=x; coda_session=invalid' },
      },
      disconnect: vi.fn(),
    };
    await gateway.handleConnection(invalid as never);
    expect(invalid.disconnect).toHaveBeenCalledWith(true);

    const active = {
      data: {},
      handshake: {
        headers: { origin: 'http://localhost:3000', cookie: 'coda_session=valid%20token' },
      },
      disconnect: vi.fn(),
    };
    await gateway.handleConnection(active as never);
    expect(active.data).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    expect(active.disconnect).not.toHaveBeenCalled();
  });

  it('rechecks authentication and membership whenever a socket joins a project', async () => {
    const prisma = {
      projectMembership: { findUnique: vi.fn() },
      session: { findFirst: vi.fn() },
    };
    const gateway = new RealtimeGateway(prisma as never);
    const unauthenticated = socket('', '');
    unauthenticated.data = {} as never;
    await expect(gateway.join(unauthenticated as never, 'project-1')).resolves.toEqual({
      joined: false,
    });

    const active = socket('user-1', 'session-1');
    prisma.projectMembership.findUnique.mockResolvedValueOnce({ user: { status: 'ACTIVE' } });
    prisma.session.findFirst.mockResolvedValueOnce({ id: 'session-1' });
    await expect(gateway.join(active as never, 'project-1')).resolves.toEqual({ joined: true });
    expect(active.join).toHaveBeenCalledWith('project:project-1');

    prisma.projectMembership.findUnique.mockResolvedValueOnce({ user: { status: 'SUSPENDED' } });
    prisma.session.findFirst.mockResolvedValueOnce({ id: 'session-1' });
    await expect(gateway.join(active as never, 'project-1')).resolves.toEqual({ joined: false });
  });

  it('treats missing projects, absent servers, and delivery failures as best effort', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const gateway = new RealtimeGateway({ project: { findUnique } } as never);
    await expect(gateway.invalidateProject('missing', 'items', [])).resolves.toBeUndefined();
    await expect(gateway.invalidateProject('project-1', 'items', [])).resolves.toBeUndefined();
    await expect(gateway.disconnectSession('session')).resolves.toBeUndefined();
  });

  it('disconnects sockets belonging to a logged-out session', async () => {
    const matching = socket('user', 'session');
    const other = socket('other', 'other-session');
    const gateway = new RealtimeGateway({} as never);
    Reflect.set(gateway, 'server', {
      fetchSockets: vi.fn().mockResolvedValue([matching, other]),
    });

    await gateway.disconnectSession('session');

    expect(matching.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
  });
});
