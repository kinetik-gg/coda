import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScheduledBackupHistoryEntry,
  ScheduledBackupSettings,
  StorageProbeResult,
} from '@coda/contracts';

import { ScheduledBackupService } from './scheduled-backup.service';

const OWNER = 'owner-1';

const enabledSettings: ScheduledBackupSettings = {
  enabled: true,
  intervalHours: 24,
  retention: { keepLast: 7, dailyForDays: 0, weeklyForWeeks: 0, maxAgeDays: 0 },
};

const okProbe: StorageProbeResult = {
  ok: true,
  checks: [{ name: 'write', ok: true, detail: 'ok' }],
};
const badProbe: StorageProbeResult = {
  ok: false,
  checks: [{ name: 'write', ok: false, detail: 'denied' }],
};

const connection = {
  provider: 'minio' as const,
  endpoint: 'http://backup-minio:9000',
  publicEndpoint: 'http://localhost:60000',
  region: 'us-east-1',
  bucket: 'dedicated-backup',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

function makeDestination(probe: StorageProbeResult) {
  const state = { source: 'active' as 'active' | 'override', bucket: 'active-bucket' };
  return {
    describe: vi.fn(() =>
      Promise.resolve({
        source: state.source,
        provider: 'minio' as const,
        endpoint: 'http://minio:9000',
        bucket: state.bucket,
        prefix: 'backups/scheduled/',
        forcePathStyle: true,
      }),
    ),
    probe: vi.fn(() => Promise.resolve(probe)),
    persist: vi.fn((input: typeof connection) => {
      if (probe.ok) {
        state.source = 'override';
        state.bucket = input.bucket;
      }
      return Promise.resolve({ probe, applied: probe.ok });
    }),
    clear: vi.fn(() => {
      state.source = 'active';
      state.bucket = 'active-bucket';
      return Promise.resolve();
    }),
  };
}

function build(
  options: {
    owner?: string | null;
    config?: Record<string, unknown>;
    probe?: StorageProbeResult;
    runOutcome?: 'success' | 'throw';
  } = {},
) {
  const store = new Map<string, unknown>(Object.entries(options.config ?? {}));
  const prisma = {
    instanceSettings: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.owner === undefined
            ? { ownerUserId: OWNER }
            : options.owner === null
              ? null
              : { ownerUserId: options.owner },
        ),
    },
  };
  const instanceConfig = {
    getConfig: vi.fn((key: string) => Promise.resolve(store.get(key))),
    setConfig: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteConfig: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
  const signing = {
    ensureKeyMaterial: vi
      .fn()
      .mockResolvedValue({ privateKeyPem: 'priv', publicKeyPem: 'pub', fingerprint: 'fp' }),
    fingerprint: vi.fn().mockResolvedValue('fp'),
  };
  const engine = {
    run:
      options.runOutcome === 'throw'
        ? vi.fn().mockRejectedValue(new Error('destination unreachable'))
        : vi.fn().mockResolvedValue({
            archiveKey: 'backups/scheduled/x.codabackup',
            sizeBytes: 1234,
            prunedCount: 2,
          }),
  };
  const destination = makeDestination(options.probe ?? okProbe);
  const service = new ScheduledBackupService(
    prisma as never,
    instanceConfig as never,
    signing as never,
    engine as never,
    destination as never,
  );
  return { service, store, prisma, instanceConfig, signing, engine, destination };
}

function historyEntry(finishedAt: string): ScheduledBackupHistoryEntry {
  return {
    id: 'h1',
    reason: 'scheduled',
    startedAt: finishedAt,
    finishedAt,
    outcome: 'SUCCESS',
    archiveKey: 'backups/scheduled/prev.codabackup',
    sizeBytes: 10,
    prunedCount: 0,
    error: null,
  };
}

describe('ScheduledBackupService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('tick gating', () => {
    it('does nothing when the schedule is disabled', async () => {
      const { service, engine } = build({
        config: { 'backup.schedule': { ...enabledSettings, enabled: false } },
      });
      expect(await service.tick('scheduled')).toBeNull();
      expect(engine.run).not.toHaveBeenCalled();
    });

    it('does nothing when enabled but not yet due', async () => {
      const { service, engine } = build({
        config: {
          'backup.schedule': enabledSettings,
          'backup.history': { entries: [historyEntry(new Date().toISOString())] },
        },
      });
      expect(await service.tick('scheduled')).toBeNull();
      expect(engine.run).not.toHaveBeenCalled();
    });

    it('runs and records success when due', async () => {
      const past = new Date(Date.now() - 48 * 3_600_000).toISOString();
      const { service, engine, store } = build({
        config: {
          'backup.schedule': enabledSettings,
          'backup.history': { entries: [historyEntry(past)] },
        },
      });
      const result = await service.tick('scheduled');
      expect(result?.outcome).toBe('SUCCESS');
      expect(engine.run).toHaveBeenCalledOnce();
      const history = store.get('backup.history') as { entries: ScheduledBackupHistoryEntry[] };
      expect(history.entries[0]!.outcome).toBe('SUCCESS');
      expect(history.entries[0]!.archiveKey).toBe('backups/scheduled/x.codabackup');
    });

    it('runs immediately on first tick when no history exists', async () => {
      const { service, engine } = build({ config: { 'backup.schedule': enabledSettings } });
      const result = await service.tick('scheduled');
      expect(result?.outcome).toBe('SUCCESS');
      expect(engine.run).toHaveBeenCalledOnce();
    });

    it('records a failure entry when the run throws, without rethrowing from tick', async () => {
      const { service, store } = build({
        config: { 'backup.schedule': enabledSettings },
        runOutcome: 'throw',
      });
      const result = await service.tick('scheduled', { force: true });
      expect(result?.outcome).toBe('FAILURE');
      const history = store.get('backup.history') as { entries: ScheduledBackupHistoryEntry[] };
      expect(history.entries[0]!.outcome).toBe('FAILURE');
      expect(history.entries[0]!.error).toContain('destination unreachable');
      expect(history.entries[0]!.prunedCount).toBe(0);
    });
  });

  describe('tickJob', () => {
    it('rethrows so the scheduler records a failed run', async () => {
      const { service } = build({
        config: { 'backup.schedule': enabledSettings },
        runOutcome: 'throw',
      });
      await expect(service.tickJob()).rejects.toThrow('destination unreachable');
    });

    it('resolves quietly when nothing is due', async () => {
      const { service } = build({
        config: { 'backup.schedule': { ...enabledSettings, enabled: false } },
      });
      await expect(service.tickJob()).resolves.toBeUndefined();
    });
  });

  describe('runNow', () => {
    it('forces a run even when disabled', async () => {
      const { service, engine } = build({
        config: { 'backup.schedule': { ...enabledSettings, enabled: false } },
      });
      const result = await service.runNow(OWNER);
      expect(result.outcome).toBe('SUCCESS');
      expect(engine.run).toHaveBeenCalledOnce();
    });

    it('is owner-gated', async () => {
      const { service } = build({ owner: 'someone-else' });
      await expect(service.runNow(OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('describe', () => {
    it('assembles settings, destination, status and history', async () => {
      const past = new Date(Date.now() - 48 * 3_600_000).toISOString();
      const { service } = build({
        config: {
          'backup.schedule': enabledSettings,
          'backup.history': { entries: [historyEntry(past)] },
        },
      });
      const view = await service.describe(OWNER);
      expect(view.settings).toEqual(enabledSettings);
      expect(view.destination.source).toBe('active');
      expect(view.destination.bucket).toBe('active-bucket');
      expect(view.destination.prefix).toBe('backups/scheduled/');
      expect(view.status.enabled).toBe(true);
      expect(view.status.lastOutcome).toBe('SUCCESS');
      expect(view.status.nextDueAt).not.toBeNull();
      expect(view.verificationKeyFingerprint).toBe('fp');
      expect(view.history).toHaveLength(1);
    });

    it('returns defaults and null status when nothing is configured', async () => {
      const { service, signing } = build();
      signing.fingerprint.mockResolvedValue(null);
      const view = await service.describe(OWNER);
      expect(view.settings.enabled).toBe(false);
      expect(view.settings.intervalHours).toBe(24);
      expect(view.settings.retention.keepLast).toBe(7);
      expect(view.status.lastOutcome).toBeNull();
      expect(view.status.nextDueAt).toBeNull();
      expect(view.verificationKeyFingerprint).toBeNull();
    });

    it('rejects non-administrators and uninitialised instances', async () => {
      await expect(build({ owner: 'x' }).service.describe(OWNER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(build({ owner: null }).service.describe(OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    it('persists settings and generates a signing key when enabling', async () => {
      const { service, instanceConfig, signing } = build();
      await service.updateSettings(OWNER, enabledSettings);
      expect(signing.ensureKeyMaterial).toHaveBeenCalledWith(OWNER);
      expect(instanceConfig.setConfig).toHaveBeenCalledWith(
        'backup.schedule',
        enabledSettings,
        OWNER,
      );
    });

    it('does not force key generation when saving a disabled schedule', async () => {
      const { service, signing } = build();
      await service.updateSettings(OWNER, { ...enabledSettings, enabled: false });
      expect(signing.ensureKeyMaterial).not.toHaveBeenCalled();
    });
  });

  describe('destination override', () => {
    it('validates without persisting', async () => {
      const { service, destination } = build();
      const probe = await service.validateDestination(OWNER, connection);
      expect(probe).toBe(okProbe);
      expect(destination.probe).toHaveBeenCalledWith(connection);
      expect(destination.persist).not.toHaveBeenCalled();
    });

    it('persists a validated override and reports it in the view', async () => {
      const { service, destination } = build();
      const result = await service.setDestination(OWNER, connection);
      expect(result.status).toBe('applied');
      expect(destination.persist).toHaveBeenCalledWith(connection, OWNER);
      expect(result.view?.destination.source).toBe('override');
      expect(result.view?.destination.bucket).toBe('dedicated-backup');
    });

    it('never persists an override whose probe fails', async () => {
      const { service } = build({ probe: badProbe });
      const result = await service.setDestination(OWNER, connection);
      expect(result.status).toBe('invalid');
      expect(result.view).toBeUndefined();
    });

    it('clears the override', async () => {
      const { service, destination } = build();
      const view = await service.clearDestination(OWNER);
      expect(destination.clear).toHaveBeenCalledOnce();
      expect(view.destination.source).toBe('active');
    });
  });
});
