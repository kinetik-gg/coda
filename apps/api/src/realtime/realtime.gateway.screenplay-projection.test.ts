import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenplayCollabProjectionService } from '../screenplays/collab/screenplay-collab-projection.service';
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

/**
 * The projection service is real here, with only its database work stubbed: scheduling and the
 * 700 ms cadence belong to it alone (#264), so a harness that faked `schedule` would assert the
 * gateway against a policy no longer in the gateway.
 */
function projectionHarness() {
  const room = { emit: vi.fn() };
  const relay = { emit: vi.fn() };
  const client = {
    id: 'socket-1',
    data: { userId: 'user-1' },
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn(),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue(relay),
  };
  const collabLog = {
    assertJoin: vi.fn().mockResolvedValue({
      userId: 'user-1',
      displayName: 'Ada',
      permissions: ['read_screenplay', 'edit_screenplay'],
    }),
    resolveAccess: vi.fn().mockResolvedValue(['read_screenplay', 'edit_screenplay']),
    ensureBootstrapped: vi.fn().mockResolvedValue(undefined),
    loadSyncState: vi.fn().mockResolvedValue({
      update: new Uint8Array([1]),
      serverStateVector: new Uint8Array([0]),
    }),
    appendUpdate: vi.fn().mockResolvedValue(2),
  };
  const collabProjection = new ScreenplayCollabProjectionService({} as never, {
    maxDocumentsPerOwner: 20,
    maxSourceBytesPerOwner: 1_000_000,
    maxCheckpointsPerScreenplay: 100,
    maxCheckpointBytesPerOwner: 1_000_000,
  });
  const project = vi.spyOn(collabProjection, 'project').mockResolvedValue(11);
  const gateway = new RealtimeGateway({} as never, collabLog as never, collabProjection);
  gateway.server = { in: vi.fn().mockReturnValue(room) } as never;
  return { client, collabLog, collabProjection, gateway, project, room };
}

async function join(gateway: RealtimeGateway, client: object) {
  await gateway.joinScreenplay(client as never, {
    screenplayId: 'screenplay-id',
    stateVector: new Uint8Array(),
  });
}

describe('RealtimeGateway screenplay collaboration projection', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces ordinary update projection and broadcasts the canonical version', async () => {
    const { client, gateway, project, room } = projectionHarness();
    await join(gateway, client);

    await gateway.screenplayUpdate(client as never, {
      screenplayId: 'screenplay-id',
      update: new Uint8Array([7]),
    });

    await vi.advanceTimersByTimeAsync(699);
    expect(project).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(project).toHaveBeenCalledWith('screenplay-id');
    expect(room.emit).toHaveBeenCalledWith('screenplay-collaboration-projected', {
      screenplayId: 'screenplay-id',
      version: 11,
    });
  });

  it('flushes immediately and cancels the pending debounce before save or export', async () => {
    const { client, gateway, project, room } = projectionHarness();
    await join(gateway, client);
    await gateway.screenplayUpdate(client as never, {
      screenplayId: 'screenplay-id',
      update: new Uint8Array([8]),
    });

    await expect(
      gateway.flushScreenplayCollaboration(client as never, { screenplayId: 'screenplay-id' }),
    ).resolves.toEqual({ status: 200, version: 11 });

    expect(project).toHaveBeenCalledTimes(1);
    expect(room.emit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(700);
    expect(project).toHaveBeenCalledTimes(1);
  });

  it('does not disclose an unjoined screenplay through the flush event', async () => {
    const { client, gateway, project } = projectionHarness();

    await expect(
      gateway.flushScreenplayCollaboration(client as never, { screenplayId: 'screenplay-id' }),
    ).resolves.toEqual({ status: 404 });
    expect(project).not.toHaveBeenCalled();
  });

  it('does not broadcast a version when the debounced projection resolves nothing', async () => {
    const { client, gateway, project, room } = projectionHarness();
    project.mockResolvedValue(undefined);
    await join(gateway, client);

    await gateway.screenplayUpdate(client as never, {
      screenplayId: 'screenplay-id',
      update: new Uint8Array([7]),
    });
    await vi.advanceTimersByTimeAsync(700);

    expect(project).toHaveBeenCalledOnce();
    expect(room.emit).not.toHaveBeenCalled();
  });

  it('keeps a failed background projection out of the publish acknowledgement', async () => {
    const { client, gateway, project, room } = projectionHarness();
    project.mockRejectedValue(new Error('serialization failure'));
    await join(gateway, client);

    await expect(
      gateway.screenplayUpdate(client as never, {
        screenplayId: 'screenplay-id',
        update: new Uint8Array([7]),
      }),
    ).resolves.toEqual({ status: 200, seq: 2 });
    await vi.advanceTimersByTimeAsync(700);

    expect(room.emit).not.toHaveBeenCalled();
  });
});
