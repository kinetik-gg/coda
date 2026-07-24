import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../config/runtime-capabilities', () => ({
  runtimeCapabilities: () => ({ realtimeFanout: 'single-user' }),
}));

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

describe('RealtimeGateway under the desktop (single-user) profile', () => {
  it('delivers to sockets in the room without the multi-user re-authorization queries', async () => {
    const owner = socket('local-owner', 'local-session');
    const prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ revision: 4 }) },
      projectMembership: { findMany: vi.fn() },
      session: { findMany: vi.fn() },
    };
    const gateway = new RealtimeGateway(prisma as never);
    Reflect.set(gateway, 'server', {
      in: vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue([owner]) }),
    });

    await gateway.invalidateProject('project-1', 'items', ['item-1']);

    expect(owner.emit).toHaveBeenCalledWith('invalidate', {
      projectId: 'project-1',
      resource: 'items',
      ids: ['item-1'],
      revision: 4,
    });
    // The membership/session cross-checks are skipped entirely for a single local user.
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });
});
