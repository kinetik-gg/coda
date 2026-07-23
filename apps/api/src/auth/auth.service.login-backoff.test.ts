import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_PUBLIC_ENDPOINT = 'http://storage.localhost:9000';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ACCESS_KEY = 'test-access-key';
process.env.S3_SECRET_KEY = 'test-secret-key';
process.env.AUTH_LOGIN_BACKOFF_THRESHOLD = '5';
process.env.AUTH_LOGIN_BACKOFF_WINDOWS_MS = '60000,300000,900000';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('argon2', () => ({
  verify,
  hash: vi.fn().mockResolvedValue('$argon2id$hash'),
}));

type UserRow = {
  id: string;
  status: string;
  passwordHash: string;
  failedLoginAttempts: number;
  loginLockedUntil: Date | null;
};

function activeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-id',
    status: 'ACTIVE',
    passwordHash: '$argon2id$real',
    failedLoginAttempts: 0,
    loginLockedUntil: null,
    ...overrides,
  };
}

function serviceFor(user: UserRow | null) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(user);
  const service = new AuthService({ user: { findUnique, update } } as never);
  return { service, update, findUnique };
}

describe('AuthService account-scoped login backoff', () => {
  beforeEach(() => {
    verify.mockReset();
  });

  it('records a failure and stays unlocked below the threshold', async () => {
    verify.mockResolvedValue(false);
    const { service, update } = serviceFor(activeUser({ failedLoginAttempts: 2 }));

    await expect(service.login('person@example.test', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verify).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0]![0] as { data: UserRow };
    expect(payload.data.failedLoginAttempts).toBe(3);
    expect(payload.data.loginLockedUntil).toBeNull();
  });

  it('opens a delay window on the failure that reaches the threshold', async () => {
    verify.mockResolvedValue(false);
    const { service, update } = serviceFor(activeUser({ failedLoginAttempts: 4 }));

    await expect(service.login('person@example.test', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const payload = update.mock.calls[0]![0] as { data: UserRow };
    expect(payload.data.failedLoginAttempts).toBe(5);
    expect(payload.data.loginLockedUntil).toBeInstanceOf(Date);
    expect((payload.data.loginLockedUntil as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a locked account even with the correct password, without mutating state', async () => {
    verify.mockResolvedValue(true);
    const { service, update } = serviceFor(
      activeUser({ failedLoginAttempts: 5, loginLockedUntil: new Date(Date.now() + 60_000) }),
    );

    await expect(service.login('person@example.test', 'correct')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // The constant-time verify still runs so a locked account is timing-indistinguishable from a
    // wrong-password attempt, and no counter escalation happens inside the active window.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('resumes accepting logins once the lock window has elapsed', async () => {
    verify.mockResolvedValue(true);
    const { service, update } = serviceFor(
      activeUser({ failedLoginAttempts: 6, loginLockedUntil: new Date(Date.now() - 1_000) }),
    );

    await expect(service.login('person@example.test', 'correct')).resolves.toMatchObject({
      id: 'user-id',
    });
    // A successful login clears the persisted counter and lock.
    const payload = update.mock.calls[0]![0] as { data: UserRow };
    expect(payload.data).toMatchObject({ failedLoginAttempts: 0, loginLockedUntil: null });
  });

  it('does not write when a clean account logs in successfully', async () => {
    verify.mockResolvedValue(true);
    const { service, update } = serviceFor(activeUser());

    await expect(service.login('person@example.test', 'correct')).resolves.toMatchObject({
      id: 'user-id',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('never records failures for a missing or disabled account and always spends one verify', async () => {
    verify.mockResolvedValue(false);
    const missing = serviceFor(null);
    await expect(missing.service.login('ghost@example.test', 'x')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(missing.update).not.toHaveBeenCalled();

    const disabled = serviceFor(activeUser({ status: 'DISABLED' }));
    await expect(disabled.service.login('disabled@example.test', 'x')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(disabled.update).not.toHaveBeenCalled();
    // One verify per attempt in every branch, so existence and lock state are timing-opaque.
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('presents an identical rejection whether the account is missing, wrong, or locked', async () => {
    verify.mockResolvedValue(false);
    const messages: string[] = [];
    for (const user of [
      null,
      activeUser({ failedLoginAttempts: 1 }),
      activeUser({ failedLoginAttempts: 9, loginLockedUntil: new Date(Date.now() + 60_000) }),
    ]) {
      const { service } = serviceFor(user);
      await service
        .login('person@example.test', 'value')
        .catch((error: UnauthorizedException) => messages.push(error.message));
    }
    expect(messages).toEqual([
      'Invalid email or password',
      'Invalid email or password',
      'Invalid email or password',
    ]);
  });

  it('clears the counter and lock when a password reset completes', async () => {
    const reset = {
      id: 'reset-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { email: 'locked-member@coda.local' },
    };
    const userUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      passwordResetToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      user: { update: userUpdate },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new AuthService({
      passwordResetToken: { findUnique: vi.fn().mockResolvedValue(reset) },
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    } as never);

    await service.resetPassword('a'.repeat(64), 'RecoveredPassword2026');

    const payload = userUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({ failedLoginAttempts: 0, loginLockedUntil: null });
  });
});
