import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UpdatesService } from './updates.service';

vi.mock('../config/env', () => ({ env: vi.fn(() => ({ UPDATE_CHECK_INTERVAL_HOURS: 24 })) }));

const baseStatus = {
  current: '1.2.3',
  latest: '1.3.0',
  updateAvailable: true,
  comparison: 'behind' as const,
  notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
  lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastSucceededAt: new Date('2026-01-01T00:00:00.000Z'),
  lastError: null,
};

function service({
  ownerUserId = 'owner',
  hasSettings = true,
  status = vi.fn().mockResolvedValue(baseStatus),
  check = vi.fn().mockResolvedValue(baseStatus),
  configValues = {} as Record<string, unknown>,
}: {
  ownerUserId?: string;
  hasSettings?: boolean;
  status?: ReturnType<typeof vi.fn>;
  check?: ReturnType<typeof vi.fn>;
  configValues?: Record<string, unknown>;
} = {}) {
  const prisma = {
    instanceSettings: {
      findFirst: vi.fn().mockResolvedValue(hasSettings ? { ownerUserId } : null),
    },
  };
  const releaseChecker = { status, check };
  const store: Record<string, unknown> = { ...configValues };
  const config = {
    getConfig: vi.fn((key: string) => Promise.resolve(store[key])),
    setConfig: vi.fn((key: string, value: unknown) => {
      store[key] = value;
      return Promise.resolve(undefined);
    }),
  };
  return {
    service: new UpdatesService(prisma as never, releaseChecker as never, config as never),
    prisma,
    releaseChecker,
    config,
  };
}

describe('UpdatesService owner gating', () => {
  it('rejects a non-owner before reading release-checker state', async () => {
    const { service: instance, releaseChecker } = service({ ownerUserId: 'owner' });

    await expect(instance.status('member')).rejects.toBeInstanceOf(ForbiddenException);
    expect(releaseChecker.status).not.toHaveBeenCalled();
  });

  it('rejects when instance setup is incomplete', async () => {
    const { service: instance } = service({ hasSettings: false });

    await expect(instance.status('anyone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the owner to read status, check, set preference, and dismiss', async () => {
    const { service: instance } = service({ ownerUserId: 'owner' });

    await expect(instance.status('owner')).resolves.toMatchObject({ latest: '1.3.0' });
    await expect(instance.check('owner')).resolves.toMatchObject({ latest: '1.3.0' });
    await expect(instance.setPollingPreference('owner', 6)).resolves.toMatchObject({
      polling: { overrideHours: 6 },
    });
    await expect(instance.dismissRelease('owner', '1.3.0')).resolves.toMatchObject({
      dismissedVersion: '1.3.0',
    });
  });
});

describe('UpdatesService.status composition', () => {
  it('reports the env default as the effective interval when no override is stored', async () => {
    const { service: instance } = service({ configValues: {} });

    await expect(instance.status('owner')).resolves.toMatchObject({
      polling: { envDefaultHours: 24, overrideHours: null, effectiveHours: 24, source: 'env' },
    });
  });

  it('reports a stored override, including an explicit 0 (disabled), as the effective interval', async () => {
    const { service: instance } = service({
      configValues: { 'update.pollInterval': { hours: 0 } },
    });

    await expect(instance.status('owner')).resolves.toMatchObject({
      polling: { envDefaultHours: 24, overrideHours: 0, effectiveHours: 0, source: 'config' },
    });
  });

  it('reports a custom override interval distinct from the env default', async () => {
    const { service: instance } = service({
      configValues: { 'update.pollInterval': { hours: 6 } },
    });

    await expect(instance.status('owner')).resolves.toMatchObject({
      polling: { envDefaultHours: 24, overrideHours: 6, effectiveHours: 6, source: 'config' },
    });
  });

  it('surfaces a previously dismissed version', async () => {
    const { service: instance } = service({
      configValues: { 'update.dismissedRelease': { version: '1.3.0' } },
    });

    await expect(instance.status('owner')).resolves.toMatchObject({ dismissedVersion: '1.3.0' });
  });

  it('reports no dismissed version when none is stored', async () => {
    const { service: instance } = service({ configValues: {} });

    await expect(instance.status('owner')).resolves.toMatchObject({ dismissedVersion: null });
  });
});

describe('UpdatesService.check', () => {
  it('delegates to the release checker and composes the fresh status', async () => {
    const { service: instance, releaseChecker } = service();

    await instance.check('owner');

    expect(releaseChecker.check).toHaveBeenCalledOnce();
    expect(releaseChecker.status).not.toHaveBeenCalled();
  });
});

describe('UpdatesService preference and dismissal persistence', () => {
  it('persists a polling-interval override under the config store', async () => {
    const { service: instance, config } = service();

    await instance.setPollingPreference('owner', 12);

    expect(config.setConfig).toHaveBeenCalledWith('update.pollInterval', { hours: 12 }, 'owner');
  });

  it('persists null to revert to the environment default', async () => {
    const { service: instance, config } = service();

    await instance.setPollingPreference('owner', null);

    expect(config.setConfig).toHaveBeenCalledWith('update.pollInterval', { hours: null }, 'owner');
  });

  it('persists a dismissed release version under the config store', async () => {
    const { service: instance, config } = service();

    await instance.dismissRelease('owner', '1.3.0');

    expect(config.setConfig).toHaveBeenCalledWith(
      'update.dismissedRelease',
      { version: '1.3.0' },
      'owner',
    );
  });
});
