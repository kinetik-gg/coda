import { describe, expect, it, vi } from 'vitest';
import { hashToken } from '../common/crypto';
import {
  SESSION_LAST_SEEN_THROTTLE_MS,
  findActiveSession,
  touchSessionLastSeen,
} from './session-authentication';

const TOKEN = 'a'.repeat(43);
const activeUser = { id: 'user-1', status: 'ACTIVE' } as const;

function fakeSessionStore(initial: Record<string, unknown> | null) {
  const rows = new Map<string, unknown>();
  if (initial) rows.set(TOKEN, initial);
  return {
    session: {
      findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          [...rows.values()].find(
            (row) => (row as { tokenHash: string }).tokenHash === where.tokenHash,
          ) ?? null,
        ),
      ),
      deleteMany: vi.fn(() => {
        rows.delete(TOKEN);
        return Promise.resolve({ count: 1 });
      }),
      updateMany: vi.fn(),
    },
  };
}

describe('findActiveSession', () => {
  it('fails a revoked session on its very next lookup', async () => {
    const prisma = fakeSessionStore({
      id: 'session-1',
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date(Date.now() + 60_000),
      user: activeUser,
    });

    await expect(findActiveSession(prisma as never, TOKEN)).resolves.toMatchObject({
      id: 'session-1',
    });

    await prisma.session.deleteMany();

    await expect(findActiveSession(prisma as never, TOKEN)).resolves.toBeNull();
  });

  it('rejects a malformed token without querying the database', async () => {
    const prisma = fakeSessionStore(null);

    await expect(findActiveSession(prisma as never, 'too-short')).resolves.toBeNull();
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});

describe('touchSessionLastSeen', () => {
  it('writes when the throttle window has elapsed', async () => {
    const prisma = { session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const now = new Date('2026-07-24T12:00:00.000Z');

    await touchSessionLastSeen(prisma as never, 'session-1', now);

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        lastSeenAt: { lt: new Date(now.getTime() - SESSION_LAST_SEEN_THROTTLE_MS) },
      },
      data: { lastSeenAt: now },
    });
  });
});
