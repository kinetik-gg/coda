import { NotFoundException } from '@nestjs/common';
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

function socket(userId?: string) {
  // `socket.to(room)` returns a broadcast operator; `relay` is that operator's typed double so
  // assertions on the relayed `.emit` are not routed through an untyped mock-return chain.
  const relay = { emit: vi.fn() };
  return {
    id: 'socket-1',
    data: userId ? { userId } : {},
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn(),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue(relay),
    relay,
  };
}

function collabLogMock() {
  return {
    assertJoin: vi.fn(),
    ensureBootstrapped: vi.fn().mockResolvedValue(undefined),
    loadSyncState: vi.fn().mockResolvedValue({
      update: new Uint8Array([1, 2, 3]),
      serverStateVector: new Uint8Array([4]),
    }),
    appendUpdate: vi.fn().mockResolvedValue(9),
    materializeSourceText: vi.fn().mockResolvedValue(10),
  };
}

describe('RealtimeGateway screenplay collaboration channel', () => {
  describe('joinScreenplay', () => {
    it('404s an unauthenticated socket without touching the log service', async () => {
      const collabLog = collabLogMock();
      const gateway = new RealtimeGateway({} as never, collabLog as never);

      const ack = await gateway.joinScreenplay(socket() as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      expect(ack).toEqual({ status: 404 });
      expect(collabLog.assertJoin).not.toHaveBeenCalled();
    });

    it('404s a non-member or a trashed screenplay (tenant isolation)', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockRejectedValue(new NotFoundException('Screenplay not found'));
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('stranger');

      const ack = await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      expect(ack).toEqual({ status: 404 });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('propagates an unexpected error rather than masking it as 404', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockRejectedValue(new Error('database unavailable'));
      const gateway = new RealtimeGateway({} as never, collabLog as never);

      await expect(
        gateway.joinScreenplay(socket('user-1') as never, {
          screenplayId: 'screenplay-id',
          stateVector: new Uint8Array(),
        }),
      ).rejects.toThrow('database unavailable');
    });

    it('joins the room and caches the permission set on success', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        permissions: ['read_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('user-1');

      const ack = await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array([9]),
      });

      expect(collabLog.ensureBootstrapped).toHaveBeenCalledWith('screenplay-id');
      expect(collabLog.loadSyncState).toHaveBeenCalledWith('screenplay-id', new Uint8Array([9]));
      expect(client.join).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(ack).toEqual({
        status: 200,
        permissions: ['read_screenplay'],
        identity: { userId: 'user-1', displayName: 'Ada' },
        update: new Uint8Array([1, 2, 3]),
        serverStateVector: new Uint8Array([4]),
      });

      // The cached permission set now gates screenplayUpdate without a further database round trip.
      const publishAck = await gateway.screenplayUpdate(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([1]),
      });
      expect(publishAck).toEqual({ status: 403, message: 'Missing permission: edit_screenplay' });
    });
  });

  describe('screenplayUpdate', () => {
    async function joinedEditor() {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        permissions: ['read_screenplay', 'edit_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('user-1');
      await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });
      return { gateway, client, collabLog };
    }

    it('404s a socket that never joined this screenplay', async () => {
      const collabLog = collabLogMock();
      const gateway = new RealtimeGateway({} as never, collabLog as never);

      const ack = await gateway.screenplayUpdate(socket('user-1') as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([1]),
      });

      expect(ack).toEqual({ status: 404 });
      expect(collabLog.appendUpdate).not.toHaveBeenCalled();
    });

    it('403s a read-only member without dropping its socket', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'viewer',
        displayName: 'Viewer',
        permissions: ['read_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('viewer');
      await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      const ack = await gateway.screenplayUpdate(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([1]),
      });

      expect(ack).toEqual({ status: 403, message: 'Missing permission: edit_screenplay' });
      expect(collabLog.appendUpdate).not.toHaveBeenCalled();
      // A 403 on publish must not evict the socket — it keeps receiving updates.
      expect(client.leave).not.toHaveBeenCalled();
    });

    it('appends and relays an editor publish, returning the allocated seq', async () => {
      const { gateway, client, collabLog } = await joinedEditor();

      const ack = await gateway.screenplayUpdate(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([7, 7]),
      });

      expect(collabLog.appendUpdate).toHaveBeenCalledWith(
        'screenplay-id',
        'user-1',
        'socket-1',
        new Uint8Array([7, 7]),
      );
      expect(client.to).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(client.relay.emit).toHaveBeenCalledWith('screenplay-update', {
        update: new Uint8Array([7, 7]),
      });
      expect(ack).toEqual({ status: 200, seq: 9 });
    });
  });

  describe('screenplayAwareness', () => {
    it('ignores a socket that has not joined the screenplay', () => {
      const gateway = new RealtimeGateway({} as never, collabLogMock() as never);
      const client = socket('user-1');

      gateway.screenplayAwareness(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([1]),
      });

      expect(client.to).not.toHaveBeenCalled();
    });

    it('relays to the room once joined', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        permissions: ['read_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('user-1');
      await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      gateway.screenplayAwareness(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([5]),
      });

      expect(client.to).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(client.relay.emit).toHaveBeenCalledWith('screenplay-awareness', {
        update: new Uint8Array([5]),
      });
    });
  });

  describe('handleDisconnect', () => {
    it('announces a presence drop to every screenplay room the socket had joined', async () => {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        permissions: ['read_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket('user-1');
      await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      gateway.handleDisconnect(client as never);

      expect(client.to).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(client.relay.emit).toHaveBeenCalledWith('screenplay-presence-drop', {
        userId: 'user-1',
      });
    });

    it('is a no-op for a socket that never authenticated', () => {
      const gateway = new RealtimeGateway({} as never, collabLogMock() as never);
      const client = socket();

      expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
      expect(client.to).not.toHaveBeenCalled();
    });
  });

  describe('eviction signal', () => {
    async function joinedMember(userId: string) {
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId,
        displayName: userId,
        permissions: ['read_screenplay', 'edit_screenplay'],
      });
      const gateway = new RealtimeGateway({} as never, collabLog as never);
      const client = socket(userId);
      await gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });
      return { gateway, client };
    }

    it('forces a specific member out of the room and drops its cached permissions', async () => {
      const { gateway, client } = await joinedMember('user-1');
      const other = socket('user-2');
      Reflect.set(gateway, 'server', {
        in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([client, other]) }),
      });

      await gateway.evictScreenplayMember('screenplay-id', 'user-1');

      expect(client.leave).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(client.emit).toHaveBeenCalledWith('screenplay-access-changed', {
        screenplayId: 'screenplay-id',
      });
      expect(other.leave).not.toHaveBeenCalled();

      // The permission cache is gone, so a publish from the evicted socket is refused without a
      // database round trip — the eviction signal must win the race against a stale grant.
      const ack = await gateway.screenplayUpdate(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([1]),
      });
      expect(ack).toEqual({ status: 404 });
    });

    it('evicts every current member when a screenplay is trashed', async () => {
      const { gateway, client } = await joinedMember('user-1');
      Reflect.set(gateway, 'server', {
        in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([client]) }),
      });

      await gateway.evictScreenplay('screenplay-id');

      expect(client.leave).toHaveBeenCalledWith('screenplay:screenplay-id');
      expect(client.emit).toHaveBeenCalledWith('screenplay-access-changed', {
        screenplayId: 'screenplay-id',
      });
    });

    it('is a best-effort no-throw when the server has not attached yet', async () => {
      const gateway = new RealtimeGateway({} as never, collabLogMock() as never);

      await expect(
        gateway.evictScreenplayMember('screenplay-id', 'user-1'),
      ).resolves.toBeUndefined();
      await expect(gateway.evictScreenplay('screenplay-id')).resolves.toBeUndefined();
    });

    it('logs and swallows a fetchSockets failure rather than failing the caller', async () => {
      const gateway = new RealtimeGateway({} as never, collabLogMock() as never);
      Reflect.set(gateway, 'server', {
        in: vi.fn().mockReturnValue({
          fetchSockets: vi.fn().mockRejectedValue(new Error('io unavailable')),
        }),
      });

      await expect(
        gateway.evictScreenplayMember('screenplay-id', 'user-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('the handleConnection race', () => {
    // Nothing about socket.io or Nest's gateway wiring guarantees `handleConnection` (async: it
    // awaits a session lookup) finishes before the client's first message is dispatched to a
    // `@SubscribeMessage` handler. A real socket.io-client connection hit exactly this: the
    // client's 'connect' event fires as soon as the transport opens, and a join-screenplay sent
    // immediately afterward raced ahead of the session lookup, reading `socket.data.userId` before
    // handleConnection had set it and getting a false 404 for a screenplay the caller legitimately
    // owned. `connectionReady` (awaited by every handler that reads `socket.data.userId`) closes
    // that window by having handleConnection publish its own in-flight promise before any `await`.
    it('makes joinScreenplay wait for an in-flight session lookup instead of reading userId early', async () => {
      let resolveSession!: (value: unknown) => void;
      const sessionLookup = new Promise((resolve) => {
        resolveSession = resolve;
      });
      const prisma = { session: { findUnique: vi.fn().mockReturnValue(sessionLookup) } };
      const collabLog = collabLogMock();
      collabLog.assertJoin.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        permissions: ['read_screenplay'],
      });
      const gateway = new RealtimeGateway(prisma as never, collabLog as never);
      const client = {
        ...socket(),
        handshake: {
          headers: { origin: 'http://localhost:3000', cookie: 'coda_session=valid%20token' },
        },
        disconnect: vi.fn(),
      };

      // Fired but not yet settled — mirrors the real race: the connection has arrived, but the
      // session lookup inside handleConnection has not resolved.
      const connecting = gateway.handleConnection(client as never);
      const joining = gateway.joinScreenplay(client as never, {
        screenplayId: 'screenplay-id',
        stateVector: new Uint8Array(),
      });

      resolveSession({
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: 'ACTIVE' },
      });
      await connecting;
      const ack = await joining;

      expect(ack).toMatchObject({ status: 200 });
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });
});
