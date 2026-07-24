import { randomUUID } from 'node:crypto';
import { createWriteStream, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { PRE_UPGRADE_BACKUP_PREFIX, S3BackupArchiveStore } from '../backup/backup-archive-store';
import { createBackupArchive } from '../backup/backup-core';
import { requireBackupKeyPair } from '../backup/backup-key';
import { PgDatabaseBackupEngine } from '../backup/backup-pg';
import { databaseNameFromUrl, readApiVersion } from '../backup/backup-runtime-info';
import { S3ObjectBackupStore } from '../backup/backup-s3';
import {
  type AppliedMigrationRow,
  evaluatePendingMigrations,
  readAppliedMigrations,
  readLocalMigrations,
} from './migration-status';
import {
  ensurePreUpgradeBackup,
  type PreUpgradeBackupDeps,
  type PreUpgradeLogger,
} from './pre-upgrade-backup';

export interface PreUpgradeBackupConfig {
  readonly DATABASE_URL: string;
  readonly CONFIG_ENCRYPTION_KEY?: string;
  readonly S3_ENDPOINT: string;
  readonly S3_REGION: string;
  readonly S3_BUCKET: string;
  readonly S3_ACCESS_KEY: string;
  readonly S3_SECRET_KEY: string;
  readonly S3_FORCE_PATH_STYLE: boolean;
  readonly PRE_UPGRADE_BACKUP: 'on' | 'off';
  readonly PRE_UPGRADE_BACKUP_KEEP: number;
}

/** Minimal Prisma surface the pre-upgrade step needs; narrowed for testable substitution. */
export interface PreUpgradePrisma {
  ownerCount(): Promise<number>;
  appliedMigrations(): Promise<AppliedMigrationRow[]>;
  disconnect(): Promise<void>;
}

/** Infrastructure seams so the wiring can be exercised without a real database or object store. */
export interface PreUpgradeRuntimeSeams {
  openPrisma(databaseUrl: string): PreUpgradePrisma;
  openS3(config: PreUpgradeBackupConfig): S3Client;
  runBackup: typeof createBackupArchive;
  localMigrations(apiRoot: string): string[];
  now(): Date;
}

function endStream(sink: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    sink.once('error', reject);
    sink.end(() => resolve());
  });
}

function productionSeams(): PreUpgradeRuntimeSeams {
  return {
    openPrisma(databaseUrl) {
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      return {
        ownerCount: () => client.instanceSettings.count(),
        appliedMigrations: () =>
          client.$queryRaw<AppliedMigrationRow[]>`
            SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          `,
        disconnect: () => client.$disconnect(),
      };
    },
    openS3: (config) =>
      new S3Client({
        region: config.S3_REGION,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
        endpoint: config.S3_ENDPOINT,
      }),
    runBackup: createBackupArchive,
    localMigrations: (apiRoot) => readLocalMigrations(apiRoot),
    now: () => new Date(),
  };
}

/**
 * Assemble the {@link PreUpgradeBackupDeps} for a boot run. Each database and object-store call is
 * created lazily inside the closures so importing and constructing this wiring is free of side
 * effects; the network is touched only when the step actually runs.
 */
export function buildPreUpgradeBackupDeps(
  config: PreUpgradeBackupConfig,
  apiRoot: string,
  logger: PreUpgradeLogger,
  seams: PreUpgradeRuntimeSeams = productionSeams(),
): PreUpgradeBackupDeps {
  return {
    enabled: config.PRE_UPGRADE_BACKUP !== 'off',
    keep: config.PRE_UPGRADE_BACKUP_KEEP,
    archiveKey: () =>
      `${PRE_UPGRADE_BACKUP_PREFIX}${seams
        .now()
        .toISOString()
        .replace(/[:.]/gu, '-')}-v${readApiVersion(apiRoot)}.codabk`,
    async pendingMigrations() {
      const prisma = seams.openPrisma(config.DATABASE_URL);
      try {
        const applied = await readAppliedMigrations(() => prisma.appliedMigrations());
        return evaluatePendingMigrations(seams.localMigrations(apiRoot), applied);
      } finally {
        await prisma.disconnect();
      }
    },
    async createArchive(key) {
      const { signingKey } = requireBackupKeyPair(config.CONFIG_ENCRYPTION_KEY);
      const prisma = seams.openPrisma(config.DATABASE_URL);
      const client = seams.openS3(config);
      const objects = new S3ObjectBackupStore(client, config.S3_BUCKET);
      const database = new PgDatabaseBackupEngine({
        databaseUrl: config.DATABASE_URL,
        isInitialized: async () => (await prisma.ownerCount()) > 0,
      });
      const archivePath = join(tmpdir(), `coda-pre-upgrade-${randomUUID()}.codabk`);
      const sink = createWriteStream(archivePath, { mode: 0o600 });
      try {
        await seams.runBackup({
          database,
          objects,
          sink,
          signingKey,
          context: {
            reason: 'pre-upgrade',
            appVersion: readApiVersion(apiRoot),
            databaseName: databaseNameFromUrl(config.DATABASE_URL),
          },
        });
        await endStream(sink);
        await new S3BackupArchiveStore(client, config.S3_BUCKET).put(
          key,
          archivePath,
          statSync(archivePath).size,
        );
      } finally {
        rmSync(archivePath, { force: true });
        await prisma.disconnect();
      }
    },
    prune: () =>
      new S3BackupArchiveStore(seams.openS3(config), config.S3_BUCKET).pruneToLast(
        PRE_UPGRADE_BACKUP_PREFIX,
        config.PRE_UPGRADE_BACKUP_KEEP,
      ),
    logger,
  };
}

/**
 * Build the boot-time pre-upgrade backup step used as the `preMigrate` hook in the database-readiness
 * loop. Returns a closure so construction stays side-effect free; a thrown safety-backup failure
 * propagates into the diagnostic retry loop.
 */
export function createPreUpgradeBackupStep(
  config: PreUpgradeBackupConfig,
  apiRoot: string,
  seams?: PreUpgradeRuntimeSeams,
): () => Promise<void> {
  const logger = new Logger('PreUpgradeBackup');
  return () =>
    ensurePreUpgradeBackup(
      buildPreUpgradeBackupDeps(
        config,
        apiRoot,
        {
          log: (message) => logger.log(message),
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        },
        seams,
      ),
    );
}
