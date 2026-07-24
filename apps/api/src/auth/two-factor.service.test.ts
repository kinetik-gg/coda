import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash as argon2Hash } from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import {
  decryptConfigValue,
  deriveConfigKey,
  encryptConfigValue,
} from '../config/instance-config-crypto';
import { hashToken } from '../common/crypto';
import { TwoFactorService } from './two-factor.service';
import { base32Decode, generateTotpSecret, totp } from './totp';

// A real key + real AES-GCM so the service exercises genuine decrypt-then-verify.
const KEY_MATERIAL = Buffer.alloc(32, 7).toString('base64');
const key = deriveConfigKey(KEY_MATERIAL);
const SECRET = generateTotpSecret();
const encryptedSecret = encryptConfigValue(key, SECRET);
const NOW = 1_700_000_000_000;

function encryptionMock(configured = true) {
  return {
    get configured() {
      return configured;
    },
    encrypt: (plaintext: string) => encryptConfigValue(key, plaintext),
    decrypt: (ciphertext: Buffer, nonce: Buffer) => decryptConfigValue(key, ciphertext, nonce),
  };
}

function activeRecord(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    secretCiphertext: new Uint8Array(encryptedSecret.ciphertext),
    secretNonce: new Uint8Array(encryptedSecret.nonce),
    activatedAt: new Date(NOW - 1000),
    lastUsedCounter: null,
    ...overrides,
  };
}

function transactionRunner(store: Record<string, unknown>) {
  return vi.fn((arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: typeof store) => unknown)(store);
    return Promise.all(arg as Promise<unknown>[]);
  });
}

describe('TwoFactorService.status', () => {
  it('reports a disabled account with no record', async () => {
    const prisma = { userTwoFactor: { findUnique: vi.fn().mockResolvedValue(null) } };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.status('user-1')).resolves.toEqual({
      enabled: false,
      pending: false,
      available: true,
      recoveryCodesRemaining: 0,
    });
  });

  it('reports a pending enrollment before activation', async () => {
    const prisma = {
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord({ activatedAt: null })) },
      userTwoFactorRecoveryCode: { count: vi.fn() },
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.status('user-1')).resolves.toMatchObject({
      enabled: false,
      pending: true,
      recoveryCodesRemaining: 0,
    });
    expect(prisma.userTwoFactorRecoveryCode.count).not.toHaveBeenCalled();
  });

  it('reports an enabled account with remaining recovery codes', async () => {
    const prisma = {
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord()) },
      userTwoFactorRecoveryCode: { count: vi.fn().mockResolvedValue(7) },
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.status('user-1')).resolves.toEqual({
      enabled: true,
      pending: false,
      available: true,
      recoveryCodesRemaining: 7,
    });
  });

  it('reports unavailable when no encryption key is configured', async () => {
    const prisma = { userTwoFactor: { findUnique: vi.fn().mockResolvedValue(null) } };
    const service = new TwoFactorService(prisma as never, encryptionMock(false) as never);
    await expect(service.status('user-1')).resolves.toMatchObject({ available: false });
  });
});

describe('TwoFactorService.enroll', () => {
  it('refuses without an encryption key', async () => {
    const service = new TwoFactorService({} as never, encryptionMock(false) as never);
    await expect(service.enroll('user-1', 'user@example.test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses to re-enroll an already active account', async () => {
    const prisma = { userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord()) } };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.enroll('user-1', 'user@example.test')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stores an encrypted secret and returns a QR provisioning URI', async () => {
    const tx = {
      userTwoFactorRecoveryCode: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userTwoFactor: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transactionRunner(tx),
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);

    const result = await service.enroll('user-1', 'user@example.test');
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUri).toContain('otpauth://totp/Coda:user%40example.test');
    expect(result.otpauthUri).toContain(`secret=${result.secret}`);
    const upsert = tx.userTwoFactor.upsert.mock.calls[0]![0] as { create: { userId: string } };
    expect(upsert.create.userId).toBe('user-1');
  });
});

describe('TwoFactorService.activate', () => {
  it('activates with a correct code and mints ten recovery codes', async () => {
    const tx = {
      userTwoFactor: { update: vi.fn().mockResolvedValue({}) },
      userTwoFactorRecoveryCode: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 10 }),
      },
    };
    const prisma = {
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord({ activatedAt: null })) },
      $transaction: transactionRunner(tx),
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);

    const code = totp(base32Decode(SECRET), NOW);
    const result = await service.activate('user-1', code, NOW);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.recoveryCodes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const update = tx.userTwoFactor.update.mock.calls[0]![0] as {
      data: { activatedAt: Date; lastUsedCounter: bigint };
    };
    expect(update.data.activatedAt).toBeInstanceOf(Date);
    expect(typeof update.data.lastUsedCounter).toBe('bigint');
    const created = tx.userTwoFactorRecoveryCode.createMany.mock.calls[0]![0] as {
      data: Array<{ codeHash: string }>;
    };
    expect(created.data).toHaveLength(10);
  });

  it('rejects an incorrect activation code', async () => {
    const prisma = {
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord({ activatedAt: null })) },
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.activate('user-1', '000000', NOW)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses to activate a missing enrollment or an already-active one', async () => {
    const missing = new TwoFactorService(
      { userTwoFactor: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
      encryptionMock() as never,
    );
    await expect(missing.activate('user-1', '000000', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const active = new TwoFactorService(
      { userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord()) } } as never,
      encryptionMock() as never,
    );
    await expect(active.activate('user-1', '000000', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('TwoFactorService.hasActiveTwoFactor and challenges', () => {
  it('is true only when an activation timestamp exists', async () => {
    const enabled = new TwoFactorService(
      {
        userTwoFactor: { findUnique: vi.fn().mockResolvedValue({ activatedAt: new Date() }) },
      } as never,
      encryptionMock() as never,
    );
    const pending = new TwoFactorService(
      { userTwoFactor: { findUnique: vi.fn().mockResolvedValue({ activatedAt: null }) } } as never,
      encryptionMock() as never,
    );
    await expect(enabled.hasActiveTwoFactor('user-1')).resolves.toBe(true);
    await expect(pending.hasActiveTwoFactor('user-1')).resolves.toBe(false);
  });

  it('creates a hashed, expiring challenge and returns the raw handle', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new TwoFactorService(
      { twoFactorChallenge: { create } } as never,
      encryptionMock() as never,
    );
    const token = await service.createChallenge('user-1', NOW);
    const data = create.mock.calls[0]![0] as {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(data.data.userId).toBe('user-1');
    expect(data.data.tokenHash).toBe(hashToken(token));
    expect(data.data.expiresAt.getTime()).toBe(NOW + 5 * 60_000);
  });
});

async function passwordHash(): Promise<string> {
  return argon2Hash('correct horse', { type: 2 });
}

describe('TwoFactorService.verifyLogin', () => {
  function challengeStore(overrides: Record<string, unknown> = {}) {
    const tx = {
      userTwoFactor: { update: vi.fn().mockResolvedValue({}) },
      userTwoFactorRecoveryCode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      twoFactorChallenge: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      twoFactorChallenge: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'user-1',
          expiresAt: new Date(NOW + 60_000),
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord()) },
      userTwoFactorRecoveryCode: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: transactionRunner(tx),
      ...overrides,
    };
    return { prisma, tx };
  }

  it('exchanges a valid TOTP code for the user id and advances the replay counter', async () => {
    const { prisma, tx } = challengeStore();
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    const code = totp(base32Decode(SECRET), NOW);

    await expect(service.verifyLogin('a'.repeat(43), code, NOW)).resolves.toBe('user-1');
    const update = tx.userTwoFactor.update.mock.calls[0]![0] as {
      data: { lastUsedCounter: bigint };
    };
    expect(update.data.lastUsedCounter).toBeGreaterThan(0n);
    expect(tx.twoFactorChallenge.deleteMany).toHaveBeenCalled();
  });

  it('rejects a replayed TOTP code once its counter is spent', async () => {
    const spentCounter = BigInt(Math.floor(NOW / 1000 / 30));
    const { prisma } = challengeStore({
      userTwoFactor: {
        findUnique: vi.fn().mockResolvedValue(activeRecord({ lastUsedCounter: spentCounter })),
      },
    });
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    const code = totp(base32Decode(SECRET), NOW);
    await expect(service.verifyLogin('a'.repeat(43), code, NOW)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('consumes a matching recovery code', async () => {
    const codeHash = await argon2Hash('abcde2fghi', { type: 2 });
    const { prisma, tx } = challengeStore({
      userTwoFactorRecoveryCode: {
        findMany: vi.fn().mockResolvedValue([{ id: 'rc-1', codeHash }]),
      },
    });
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);

    await expect(service.verifyLogin('a'.repeat(43), 'ABCDE-2FGHI', NOW)).resolves.toBe('user-1');
    const consumed = tx.userTwoFactorRecoveryCode.updateMany.mock.calls[0]![0] as {
      where: { id: string; usedAt: null };
    };
    expect(consumed.where.id).toBe('rc-1');
  });

  it('rejects an expired or unknown challenge', async () => {
    const expired = challengeStore({
      twoFactorChallenge: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'user-1', expiresAt: new Date(NOW - 1) }),
        deleteMany: vi.fn(),
      },
    });
    const service = new TwoFactorService(expired.prisma as never, encryptionMock() as never);
    await expect(service.verifyLogin('a'.repeat(43), '000000', NOW)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const unknown = new TwoFactorService(
      { twoFactorChallenge: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
      encryptionMock() as never,
    );
    await expect(unknown.verifyLogin('a'.repeat(43), '000000', NOW)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('TwoFactorService.disable and resetForUser', () => {
  it('disables after re-proving password and a valid code', async () => {
    const tx = {
      userTwoFactorRecoveryCode: { deleteMany: vi.fn() },
      twoFactorChallenge: { deleteMany: vi.fn() },
      userTwoFactor: { deleteMany: vi.fn() },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: await passwordHash() }),
      },
      userTwoFactor: { findUnique: vi.fn().mockResolvedValue(activeRecord()), deleteMany: vi.fn() },
      userTwoFactorRecoveryCode: { findMany: vi.fn(), deleteMany: vi.fn() },
      twoFactorChallenge: { deleteMany: vi.fn() },
      $transaction: transactionRunner(tx),
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    const code = totp(base32Decode(SECRET), NOW);
    await expect(service.disable('user-1', 'correct horse', code, NOW)).resolves.toEqual({
      disabled: true,
    });
  });

  it('rejects a disable attempt with a wrong password before checking the code', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-1', passwordHash: await passwordHash() }),
      },
      userTwoFactor: { findUnique: vi.fn() },
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.disable('user-1', 'wrong', '000000', NOW)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.userTwoFactor.findUnique).not.toHaveBeenCalled();
  });

  it('lets the instance owner reset a member two-factor', async () => {
    const tx = {
      userTwoFactorRecoveryCode: { deleteMany: vi.fn() },
      twoFactorChallenge: { deleteMany: vi.fn() },
      userTwoFactor: { deleteMany: vi.fn() },
    };
    const prisma = {
      instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'member' }) },
      userTwoFactorRecoveryCode: { deleteMany: vi.fn() },
      twoFactorChallenge: { deleteMany: vi.fn() },
      userTwoFactor: { deleteMany: vi.fn() },
      $transaction: transactionRunner(tx),
    };
    const service = new TwoFactorService(prisma as never, encryptionMock() as never);
    await expect(service.resetForUser('owner', 'member')).resolves.toEqual({ reset: true });
  });

  it('forbids a non-owner from resetting two-factor and 404s a missing target', async () => {
    const nonOwner = new TwoFactorService(
      {
        instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
      } as never,
      encryptionMock() as never,
    );
    await expect(nonOwner.resetForUser('member', 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const missing = new TwoFactorService(
      {
        instanceSettings: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner' }) },
        user: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      encryptionMock() as never,
    );
    await expect(missing.resetForUser('owner', 'target')).rejects.toBeInstanceOf(NotFoundException);
  });
});
