import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { runningVersion } from './running-version';
import { UpgradeCeremonyService } from './upgrade-ceremony.service';

vi.mock('../config/env', () => ({ env: vi.fn() }));
vi.mock('./running-version', () => ({ runningVersion: vi.fn(() => '1.2.3') }));

const mockedEnv = vi.mocked(env);
const mockedRunningVersion = vi.mocked(runningVersion);

const OWNER = 'owner-1';
const COOLIFY_TOKEN = 'fixture-coolify-token-not-a-secret';
const WEBHOOK_URL = 'https://deploy.example/hook?token=fixture-webhook-token-not-a-secret';

const TARGET = {
  version: '1.3.0',
  image: 'ghcr.io/kinetik-gg/coda',
  digest: `sha256:${'a'.repeat(64)}`,
};

interface BuildOptions {
  owner?: string | null;
  config?: Record<string, unknown>;
  target?: { version: string; image: string; digest: string } | null;
  encryptionKey?: string | null;
  runOutcome?: 'success' | 'failure';
  fetchImpl?: ReturnType<typeof vi.fn>;
  now?: number;
}

function build(options: BuildOptions = {}) {
  mockedEnv.mockReturnValue({
    CONFIG_ENCRYPTION_KEY:
      options.encryptionKey === undefined ? 'fixture-encryption-key' : options.encryptionKey,
  } as never);

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
  const config = {
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
  const releaseChecker = {
    latestReleaseTarget: vi
      .fn()
      .mockResolvedValue(options.target === undefined ? TARGET : options.target),
  };
  const scheduledBackup = {
    runNow: vi.fn().mockResolvedValue(
      options.runOutcome === 'failure'
        ? { outcome: 'FAILURE', entry: { archiveKey: null, error: 'pg_dump exited 1' } }
        : {
            outcome: 'SUCCESS',
            entry: { archiveKey: 'backups/scheduled/fresh.codabackup', error: null },
          },
    ),
  };
  const fetchImpl =
    options.fetchImpl ?? vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  const service = new UpgradeCeremonyService(
    prisma as never,
    config as never,
    releaseChecker as never,
    scheduledBackup as never,
    { fetchImpl: fetchImpl as never, now: () => options.now ?? Date.now() },
  );
  return { service, store, prisma, config, releaseChecker, scheduledBackup, fetchImpl };
}

const freshPending = {
  backupRef: 'backups/scheduled/fresh.codabackup',
  takenAt: new Date().toISOString(),
  fromVersion: '1.2.3',
  toVersion: '1.3.0',
};

beforeEach(() => mockedRunningVersion.mockReturnValue('1.2.3'));
afterEach(() => vi.clearAllMocks());

describe('UpgradeCeremonyService', () => {
  describe('describe / phase', () => {
    it('is unavailable when no newer release is known', async () => {
      const { service } = build({ target: null });
      const view = await service.describe(OWNER);
      expect(view.phase).toBe('unavailable');
      expect(view.target).toBeNull();
    });

    it('is unavailable when the latest known release is not newer', async () => {
      mockedRunningVersion.mockReturnValue('1.3.0');
      const { service } = build();
      expect((await service.describe(OWNER)).phase).toBe('unavailable');
    });

    it('requires the encryption key before a managed upgrade can start', async () => {
      const { service } = build({ encryptionKey: null });
      const view = await service.describe(OWNER);
      expect(view.phase).toBe('needs_encryption_key');
      expect(view.target?.version).toBe('1.3.0');
    });

    it('is ready_to_backup with a target and key but no fresh backup', async () => {
      const { service } = build();
      const view = await service.describe(OWNER);
      expect(view.phase).toBe('ready_to_backup');
      expect(view.target?.digestRef).toBe(`ghcr.io/kinetik-gg/coda@${TARGET.digest}`);
      expect(view.target?.taggedRef).toBe('ghcr.io/kinetik-gg/coda:1.3.0');
    });

    it('is owner-gated', async () => {
      await expect(build({ owner: 'intruder' }).service.describe(OWNER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(build({ owner: null }).service.describe(OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('backup gate', () => {
    it('takes a fresh backup, records it, and unlocks the deploy step', async () => {
      const { service, store, scheduledBackup } = build();
      const view = await service.startBackup(OWNER);

      expect(scheduledBackup.runNow).toHaveBeenCalledWith(OWNER);
      expect(view.phase).toBe('ready_to_deploy');
      expect(view.pendingBackup?.backupRef).toBe('backups/scheduled/fresh.codabackup');
      expect(store.get('upgrade.pendingBackup')).toMatchObject({ toVersion: '1.3.0' });
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'backup', outcome: 'SUCCESS' });
    });

    it('refuses to start without the encryption key and never touches the backup engine', async () => {
      const { service, scheduledBackup, store } = build({ encryptionKey: null });
      await expect(service.startBackup(OWNER)).rejects.toBeInstanceOf(PreconditionFailedException);
      expect(scheduledBackup.runNow).not.toHaveBeenCalled();
      expect(store.has('upgrade.pendingBackup')).toBe(false);
    });

    it('refuses to start when there is no upgrade target', async () => {
      const { service } = build({ target: null });
      await expect(service.startBackup(OWNER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('BLOCKS the ceremony when the backup fails: no pending state, recorded failure', async () => {
      const { service, store } = build({ runOutcome: 'failure' });
      await expect(service.startBackup(OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
      // The gate held: nothing unlocked a deploy.
      expect(store.has('upgrade.pendingBackup')).toBe(false);
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'backup', outcome: 'FAILURE' });
    });
  });

  describe('generic redeploy tier', () => {
    it('will not fire the webhook without a fresh backup, even when confirmed and configured', async () => {
      const fetchImpl = vi.fn();
      const { service } = build({
        config: { 'upgrade.redeployWebhook': { url: WEBHOOK_URL } },
        fetchImpl,
      });
      await expect(service.triggerRedeploy(OWNER, true)).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('will not fire the webhook until the operator confirms the env update', async () => {
      const fetchImpl = vi.fn();
      const { service } = build({
        config: {
          'upgrade.pendingBackup': freshPending,
          'upgrade.redeployWebhook': { url: WEBHOOK_URL },
        },
        fetchImpl,
      });
      await expect(service.triggerRedeploy(OWNER, false)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects when no webhook is configured', async () => {
      const { service } = build({ config: { 'upgrade.pendingBackup': freshPending } });
      await expect(service.triggerRedeploy(OWNER, true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('fires the webhook after confirmation and consumes the backup', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const { service, store } = build({
        config: {
          'upgrade.pendingBackup': freshPending,
          'upgrade.redeployWebhook': { url: WEBHOOK_URL },
        },
        fetchImpl,
      });
      const view = await service.triggerRedeploy(OWNER, true);

      expect(fetchImpl).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(store.has('upgrade.pendingBackup')).toBe(false);
      expect(view.phase).toBe('ready_to_backup');
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'generic', outcome: 'SUCCESS' });
    });

    it('keeps the backup for a retry when the webhook fails', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
      const { service, store } = build({
        config: {
          'upgrade.pendingBackup': freshPending,
          'upgrade.redeployWebhook': { url: WEBHOOK_URL },
        },
        fetchImpl,
      });
      await expect(service.triggerRedeploy(OWNER, true)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(store.has('upgrade.pendingBackup')).toBe(true);
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'generic', outcome: 'FAILURE' });
    });
  });

  describe('Coolify tier', () => {
    const coolifyConfig = {
      baseUrl: 'https://coolify.example',
      apiToken: COOLIFY_TOKEN,
      applicationUuid: 'app-uuid-1234',
    };

    it('pins the image, deploys, and consumes the backup on success', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      const { service, store } = build({
        config: { 'upgrade.pendingBackup': freshPending, 'upgrade.coolify': coolifyConfig },
        fetchImpl,
      });
      const view = await service.runCoolifyUpgrade(OWNER);

      expect(fetchImpl).toHaveBeenCalledTimes(2); // setImageEnv + deploy
      expect(store.has('upgrade.pendingBackup')).toBe(false);
      expect(view.phase).toBe('ready_to_backup');
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'coolify', outcome: 'SUCCESS' });
    });

    it('falls back to the generic tier with the backup INTACT when the adapter fails', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
      const { service, store } = build({
        config: { 'upgrade.pendingBackup': freshPending, 'upgrade.coolify': coolifyConfig },
        fetchImpl,
      });
      const view = await service.runCoolifyUpgrade(OWNER);

      // No throw: the flow returns a view so the UI can offer the generic tier.
      expect(view.lastCoolifyError).toContain('403');
      expect(view.phase).toBe('ready_to_deploy'); // backup still valid
      expect(store.has('upgrade.pendingBackup')).toBe(true);
      const history = store.get('upgrade.history') as {
        entries: { tier: string; outcome: string }[];
      };
      expect(history.entries[0]).toMatchObject({ tier: 'coolify', outcome: 'FAILURE' });
    });

    it('will not run without a fresh backup', async () => {
      const { service } = build({ config: { 'upgrade.coolify': coolifyConfig } });
      await expect(service.runCoolifyUpgrade(OWNER)).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });

    it('rejects when Coolify is not configured', async () => {
      const { service } = build({ config: { 'upgrade.pendingBackup': freshPending } });
      await expect(service.runCoolifyUpgrade(OWNER)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('secret handling', () => {
    it('never returns the Coolify token in the view', async () => {
      const { service } = build();
      const view = await service.setCoolify(OWNER, {
        baseUrl: 'https://coolify.example',
        apiToken: COOLIFY_TOKEN,
        applicationUuid: 'app-uuid-1234',
      });
      expect(view.coolify).toEqual({
        configured: true,
        baseUrl: 'https://coolify.example',
        applicationUuid: 'app-uuid-1234',
      });
      expect(JSON.stringify(view)).not.toContain(COOLIFY_TOKEN);
    });

    it('never writes the Coolify token to logs across configure and a failed deploy', async () => {
      const logged: string[] = [];
      const capture = (message: unknown) => {
        logged.push(String(message));
      };
      vi.spyOn(Logger.prototype, 'log').mockImplementation(capture);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(capture);

      const fetchImpl = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }));
      const { service } = build({
        config: { 'upgrade.pendingBackup': freshPending },
        fetchImpl,
      });
      await service.setCoolify(OWNER, {
        baseUrl: 'https://coolify.example',
        apiToken: COOLIFY_TOKEN,
        applicationUuid: 'app-uuid-1234',
      });
      await service.runCoolifyUpgrade(OWNER);

      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain(COOLIFY_TOKEN);
    });
  });

  describe('config management', () => {
    it('stores and clears the redeploy webhook', async () => {
      const { service, store } = build();
      let view = await service.setRedeployWebhook(OWNER, { url: WEBHOOK_URL });
      expect(view.redeployWebhookConfigured).toBe(true);
      expect(store.get('upgrade.redeployWebhook')).toEqual({ url: WEBHOOK_URL });
      view = await service.clearRedeployWebhook(OWNER);
      expect(view.redeployWebhookConfigured).toBe(false);
    });

    it('clears the Coolify adapter', async () => {
      const { service, store } = build({
        config: {
          'upgrade.coolify': {
            baseUrl: 'https://coolify.example',
            apiToken: COOLIFY_TOKEN,
            applicationUuid: 'app-uuid-1234',
          },
        },
      });
      const view = await service.clearCoolify(OWNER);
      expect(view.coolify.configured).toBe(false);
      expect(store.has('upgrade.coolify')).toBe(false);
    });
  });

  describe('backup freshness', () => {
    it('treats a stale backup as no backup and blocks the deploy', async () => {
      const stalePending = {
        ...freshPending,
        takenAt: new Date(Date.now() - 5 * 60 * 60 * 1_000).toISOString(),
      };
      const { service } = build({
        config: {
          'upgrade.pendingBackup': stalePending,
          'upgrade.redeployWebhook': { url: WEBHOOK_URL },
        },
        now: Date.now(),
      });
      const view = await service.describe(OWNER);
      expect(view.phase).toBe('ready_to_backup');
      expect(view.pendingBackup).toBeNull();
      await expect(service.triggerRedeploy(OWNER, true)).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });

    it('ignores a backup taken for a different target version', async () => {
      const { service } = build({
        config: { 'upgrade.pendingBackup': { ...freshPending, toVersion: '1.2.9' } },
      });
      const view = await service.describe(OWNER);
      expect(view.phase).toBe('ready_to_backup');
      expect(view.pendingBackup).toBeNull();
    });
  });
});
