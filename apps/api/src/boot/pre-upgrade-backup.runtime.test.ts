import type { Writable } from 'node:stream';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupKeyUnavailableError } from '../backup/backup-key';
import {
  buildPreUpgradeBackupDeps,
  createPreUpgradeBackupStep,
  type PreUpgradeBackupConfig,
  type PreUpgradeRuntimeSeams,
} from './pre-upgrade-backup.runtime';

const secret = Buffer.alloc(32, 5).toString('base64');

function baseConfig(overrides: Partial<PreUpgradeBackupConfig> = {}): PreUpgradeBackupConfig {
  return {
    DATABASE_URL: 'postgresql://coda:pw@localhost:5432/coda?schema=public',
    CONFIG_ENCRYPTION_KEY: secret,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'screenplays',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secretsecret',
    S3_FORCE_PATH_STYLE: true,
    PRE_UPGRADE_BACKUP: 'on',
    PRE_UPGRADE_BACKUP_KEEP: 3,
    ...overrides,
  };
}

class FakeS3 {
  puts: { key?: string; length?: number }[] = [];
  deleted: string[] = [];
  listResult: { Key: string }[] = [];

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      for await (const _chunk of command.input.Body as AsyncIterable<Buffer>) void _chunk;
      this.puts.push({ key: command.input.Key, length: command.input.ContentLength });
      return {};
    }
    if (command instanceof ListObjectsV2Command) return { Contents: this.listResult };
    if (command instanceof DeleteObjectsCommand) {
      this.deleted = (command.input.Delete?.Objects ?? []).map((entry) => entry.Key ?? '');
      return {};
    }
    throw new Error('unexpected command');
  }
}

function seams(overrides: Partial<PreUpgradeRuntimeSeams> = {}): {
  seams: PreUpgradeRuntimeSeams;
  prisma: {
    ownerCount: ReturnType<typeof vi.fn>;
    appliedMigrations: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  s3: FakeS3;
} {
  const prisma = {
    ownerCount: vi.fn().mockResolvedValue(1),
    appliedMigrations: vi.fn().mockResolvedValue([{ migration_name: 'a' }]),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const s3 = new FakeS3();
  return {
    prisma,
    s3,
    seams: {
      openPrisma: () => prisma,
      openS3: () => s3 as unknown as S3Client,
      runBackup: vi.fn(async (input: { sink: Writable }) => {
        await new Promise<void>((resolve, reject) =>
          input.sink.write(Buffer.from('archive-bytes'), (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        return {} as never;
      }) as unknown as PreUpgradeRuntimeSeams['runBackup'],
      localMigrations: () => ['a', 'b'],
      now: () => new Date('2026-07-24T10:20:30.000Z'),
      ...overrides,
    },
  };
}

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('buildPreUpgradeBackupDeps', () => {
  afterEach(() => vi.clearAllMocks());

  it('reflects the opt-out flag and retention count from config', () => {
    const enabled = buildPreUpgradeBackupDeps(baseConfig(), '/app/apps/api', logger, seams().seams);
    expect(enabled.enabled).toBe(true);
    expect(enabled.keep).toBe(3);
    const disabled = buildPreUpgradeBackupDeps(
      baseConfig({ PRE_UPGRADE_BACKUP: 'off' }),
      '/app/apps/api',
      logger,
      seams().seams,
    );
    expect(disabled.enabled).toBe(false);
  });

  it('builds a timestamped, prefixed archive key', () => {
    const deps = buildPreUpgradeBackupDeps(baseConfig(), '/app/apps/api', logger, seams().seams);
    expect(deps.archiveKey()).toMatch(
      /^backups\/pre-upgrade\/2026-07-24T10-20-30-000Z-v.*\.codabk$/u,
    );
  });

  it('detects pending migrations via the applied history and local set, then disconnects', async () => {
    const built = seams();
    const deps = buildPreUpgradeBackupDeps(baseConfig(), '/app/apps/api', logger, built.seams);
    expect(await deps.pendingMigrations()).toEqual({ isFreshInstall: false, pending: ['b'] });
    expect(built.prisma.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stages a signed archive and uploads it to the reserved prefix', async () => {
    const built = seams();
    const deps = buildPreUpgradeBackupDeps(baseConfig(), '/app/apps/api', logger, built.seams);
    await deps.createArchive('backups/pre-upgrade/test.codabk');
    expect(built.seams.runBackup).toHaveBeenCalledTimes(1);
    expect(built.s3.puts).toHaveLength(1);
    expect(built.s3.puts[0]?.key).toBe('backups/pre-upgrade/test.codabk');
    expect(built.s3.puts[0]?.length).toBe(Buffer.from('archive-bytes').length);
    expect(built.prisma.disconnect).toHaveBeenCalledTimes(1);
  });

  it('refuses to create an archive without the instance root secret', async () => {
    const deps = buildPreUpgradeBackupDeps(
      baseConfig({ CONFIG_ENCRYPTION_KEY: undefined }),
      '/app/apps/api',
      logger,
      seams().seams,
    );
    await expect(deps.createArchive('k')).rejects.toThrow(BackupKeyUnavailableError);
  });

  it('prunes old archives down to the retention limit', async () => {
    const built = seams();
    built.s3.listResult = [
      { Key: 'backups/pre-upgrade/1' },
      { Key: 'backups/pre-upgrade/2' },
      { Key: 'backups/pre-upgrade/3' },
      { Key: 'backups/pre-upgrade/4' },
    ];
    const deps = buildPreUpgradeBackupDeps(
      baseConfig({ PRE_UPGRADE_BACKUP_KEEP: 2 }),
      '/app/apps/api',
      logger,
      built.seams,
    );
    expect(await deps.prune()).toEqual(['backups/pre-upgrade/1', 'backups/pre-upgrade/2']);
    expect(built.s3.deleted).toEqual(['backups/pre-upgrade/1', 'backups/pre-upgrade/2']);
  });
});

describe('createPreUpgradeBackupStep', () => {
  it('returns a closure that runs the safety backup for a pending upgrade', async () => {
    const built = seams();
    const step = createPreUpgradeBackupStep(baseConfig(), '/app/apps/api', built.seams);
    await step();
    expect(built.s3.puts).toHaveLength(1);
  });

  it('is side-effect free until invoked', () => {
    const built = seams();
    const openS3 = vi.spyOn(built.seams, 'openS3');
    createPreUpgradeBackupStep(baseConfig(), '/app/apps/api', built.seams);
    expect(openS3).not.toHaveBeenCalled();
  });
});
