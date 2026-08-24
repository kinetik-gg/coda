import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway';

const { authorizedTrackerMemberIds, canJoinTrackerRoom } = vi.hoisted(() => ({
  canJoinTrackerRoom: vi.fn(),
  authorizedTrackerMemberIds: vi.fn(),
}));

vi.mock('./tracker-room', () => ({
  trackerRoom: (trackerId: string) => `tracker:${trackerId}`,
  canJoinTrackerRoom,
  authorizedTrackerMemberIds,
}));

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
    const gateway = new RealtimeGateway(prisma as never, {} as never, {} as never);
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
    const gateway = new RealtimeGateway(
      { session: { findUnique } } as never,
      {} as never,
      {} as never,
    );
    const client = {
      data: {},
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
    const gateway = new RealtimeGateway(
      { session: { findUnique } } as never,
      {} as never,
      {} as never,
    );
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
    // `ready` is the in-flight-authentication promise other handlers await (see
    // realtime.gateway.screenplay-collab.test.ts for the race it closes).
    expect(active.data).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      ready: expect.anything() as unknown,
    });
    expect(active.disconnect).not.toHaveBeenCalled();
  });

  it('rechecks authentication and membership whenever a socket joins a project', async () => {
    const prisma = {
      projectMembership: { findUnique: vi.fn() },
      session: { findFirst: vi.fn() },
    };
    const gateway = new RealtimeGateway(prisma as never, {} as never, {} as never);
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
    const gateway = new RealtimeGateway(
      { project: { findUnique } } as never,
      {} as never,
      {} as never,
    );
    await expect(gateway.invalidateProject('missing', 'items', [])).resolves.toBeUndefined();
    await expect(gateway.invalidateProject('project-1', 'items', [])).resolves.toBeUndefined();
    await expect(gateway.disconnectSession('session')).resolves.toBeUndefined();
  });

  it('disconnects sockets belonging to a logged-out session', async () => {
    const matching = socket('user', 'session');
    const other = socket('other', 'other-session');
    const gateway = new RealtimeGateway({} as never, {} as never, {} as never);
    Reflect.set(gateway, 'server', {
      fetchSockets: vi.fn().mockResolvedValue([matching, other]),
    });

    await gateway.disconnectSession('session');

    expect(matching.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
  });

  it('admits an authorized session to a tracker room and re-checks on every join', async () => {
    const prisma = {
      session: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 'session-1' }).mockResolvedValueOnce(null),
      },
    };
    const gateway = new RealtimeGateway(prisma as never, {} as never, {} as never);
    canJoinTrackerRoom.mockResolvedValue(true);

    const member = socket('user-1', 'session-1');
    await expect(gateway.joinTracker(member as never, 'tracker-1')).resolves.toEqual({
      joined: true,
    });
    expect(member.join).toHaveBeenCalledWith('tracker:tracker-1');
    expect(canJoinTrackerRoom).toHaveBeenCalledWith(prisma, 'user-1', 'tracker-1');

    // A dead session must not ride in on a still-valid membership.
    const stale = socket('user-1', 'session-1');
    await expect(gateway.joinTracker(stale as never, 'tracker-1')).resolves.toEqual({
      joined: false,
    });
    expect(stale.join).not.toHaveBeenCalled();
  });

  it('refuses tracker joins without a session identity or tracker access', async () => {
    const gateway = new RealtimeGateway(
      { session: { findFirst: vi.fn() } } as never,
      {} as never,
      {} as never,
    );

    const anonymous = { data: {} };
    await expect(gateway.joinTracker(anonymous as never, 'tracker-1')).resolves.toEqual({
      joined: false,
    });

    const outsider = socket('user-2', 'session-2');
    const gatewayWithPrisma = new RealtimeGateway(
      { session: { findFirst: vi.fn().mockResolvedValue({ id: 'session-2' }) } } as never,
      {} as never,
      {} as never,
    );
    canJoinTrackerRoom.mockResolvedValue(false);
    await expect(gatewayWithPrisma.joinTracker(outsider as never, 'tracker-1')).resolves.toEqual({
      joined: false,
    });
    expect(outsider.join).not.toHaveBeenCalled();
  });

  it('emits tracker invalidations only to sockets that retain tracker access', async () => {
    const member = socket('member-user', 'member-session');
    const evicted = socket('evicted-user', 'evicted-session');
    const expired = socket('expired-user', 'expired-session');
    const prisma = {
      tracker: { findUnique: vi.fn().mockResolvedValue({ revision: 3 }) },
      session: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'member-session', userId: 'member-user' },
          { id: 'evicted-session', userId: 'evicted-user' },
        ]),
      },
    };
    const gateway = new RealtimeGateway(prisma as never, {} as never, {} as never);
    const inAdapter = vi
      .fn()
      .mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([member, evicted, expired]) });
    Reflect.set(gateway, 'server', { in: inAdapter });
    authorizedTrackerMemberIds.mockResolvedValue(new Set(['member-user']));

    await gateway.invalidateTracker('tracker-1', 'tracker', ['tracker-1']);

    expect(prisma.tracker.findUnique).toHaveBeenCalledWith({
      where: { id: 'tracker-1' },
      select: { revision: true },
    });
    expect(authorizedTrackerMemberIds).toHaveBeenCalledWith(prisma, 'tracker-1', [
      'member-user',
      'evicted-user',
      'expired-user',
    ]);
    expect(inAdapter.mock.calls[0]?.[0]).toBe('tracker:tracker-1');
    expect(member.emit).toHaveBeenCalledWith('invalidate', {
      projectId: 'tracker-1',
      resource: 'tracker',
      ids: ['tracker-1'],
      revision: 3,
    });
    expect(evicted.leave).toHaveBeenCalledWith('tracker:tracker-1');
    expect(expired.disconnect).toHaveBeenCalledWith(true);
  });

  it('treats missing trackers and fanout failures in tracker invalidation as best effort', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const gateway = new RealtimeGateway(
      { tracker: { findUnique } } as never,
      {} as never,
      {} as never,
    );
    await expect(gateway.invalidateTracker('missing', 'tracker', [])).resolves.toBeUndefined();
    await expect(gateway.invalidateTracker('tracker-1', 'tracker', [])).resolves.toBeUndefined();
  });

  it('evicts only the affected user from a tracker room and signals the stale access', async () => {
    const member = socket('member-user', 'member-session');
    const removed = socket('removed-user', 'removed-session');
    const gateway = new RealtimeGateway({} as never, {} as never, {} as never);
    Reflect.set(gateway, 'server', {
      in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([member, removed]) }),
    });

    await gateway.evictTrackerMember('tracker-1', 'removed-user');

    expect(removed.leave).toHaveBeenCalledWith('tracker:tracker-1');
    expect(removed.emit).toHaveBeenCalledWith('tracker-access-changed', { trackerId: 'tracker-1' });
    expect(member.leave).not.toHaveBeenCalled();
    expect(member.emit).not.toHaveBeenCalled();
  });

  it('treats an absent server or eviction failure as best effort', async () => {
    const noServer = new RealtimeGateway({} as never, {} as never, {} as never);
    await expect(noServer.evictTrackerMember('tracker-1', 'user')).resolves.toBeUndefined();

    const failing = new RealtimeGateway({} as never, {} as never, {} as never);
    Reflect.set(failing, 'server', {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockRejectedValue(new Error('adapter down')),
      }),
    });
    await expect(failing.evictTrackerMember('tracker-1', 'user')).resolves.toBeUndefined();
  });
});
