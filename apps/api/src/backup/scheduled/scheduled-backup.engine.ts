import { Inject, Injectable, Optional } from '@nestjs/common';
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledBackupSettings } from '@coda/contracts';
import { env } from '../../config/env';
import { InstanceConfigService } from '../../config/instance-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { S3BlobStoreProvider } from '../../storage/blob/s3/s3-blob-store.provider';
import { createBackupArchive, type CreateBackupInput } from '../backup-core';
import type { BackupManifest } from '../backup-format';
import { PgDatabaseBackupEngine } from '../backup-pg';
import type { DatabaseBackupEngine, ObjectBackupStore } from '../backup-ports';
import { S3ObjectBackupStore } from '../backup-s3';
import { runningVersion } from '../../updates/running-version';
import {
  BackupExcludingObjectStore,
  destinationFromConnection,
  destinationFromSnapshot,
  scheduledArchiveKey,
  type ScheduledBackupDestination,
} from './scheduled-backup-destination';
import { selectScheduledBackupsToPrune } from './scheduled-backup-retention';

/** Injection seam so unit tests can substitute fakes for pg, storage, and S3. */
export const SCHEDULED_BACKUP_ADAPTERS = Symbol('SCHEDULED_BACKUP_ADAPTERS');

/** Writes a signed archive to `sink`; defaults to the streaming backup core. */
export type ArchiveWriter = (input: CreateBackupInput) => Promise<BackupManifest>;

export interface ScheduledBackupAdapters {
  database?: DatabaseBackupEngine;
  sourceObjects?: ObjectBackupStore;
  /** When set, used directly and never disposed (tests own its lifecycle). */
  destination?: ScheduledBackupDestination;
  writeArchive?: ArchiveWriter;
  workDir?: string;
}

/** What one completed scheduled backup produced. */
export interface ScheduledBackupArtifacts {
  archiveKey: string;
  sizeBytes: number;
  prunedCount: number;
}

function databaseName(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//u, '')) || 'postgres';
  } catch {
    return 'postgres';
  }
}

/**
 * Executes a single scheduled backup end to end: streams a signed archive to a
 * staged file, uploads it to the destination under `backups/scheduled/`, and only
 * then enforces retention. Pruning happens strictly after a durable upload, so a
 * failing destination throws before any delete and existing archives are never
 * touched. The destination is resolved per run — a dedicated override if
 * configured, otherwise the active primary storage snapshot.
 */
@Injectable()
export class ScheduledBackupEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: S3BlobStoreProvider,
    private readonly instanceConfig: InstanceConfigService,
    @Optional()
    @Inject(SCHEDULED_BACKUP_ADAPTERS)
    private readonly adapters: ScheduledBackupAdapters = {},
  ) {}

  async run(
    settings: ScheduledBackupSettings,
    reason: string,
    signingKey: string,
  ): Promise<ScheduledBackupArtifacts> {
    const resolved = await this.resolveDestination();
    const staging = mkdtempSync(join(this.adapters.workDir ?? tmpdir(), 'coda-scheduled-backup-'));
    try {
      const archivePath = join(staging, 'archive.codabackup');
      await this.writeArchive(archivePath, reason, signingKey);
      const sizeBytes = statSync(archivePath).size;
      const archiveKey = scheduledArchiveKey();
      // Durable write first. Any failure here throws before a single prune.
      await resolved.destination.upload(archiveKey, archivePath, sizeBytes);
      const prunedCount = await this.enforceRetention(resolved.destination, settings);
      return { archiveKey, sizeBytes, prunedCount };
    } finally {
      rmSync(staging, { force: true, recursive: true });
      resolved.dispose();
    }
  }

  private async writeArchive(
    archivePath: string,
    reason: string,
    signingKey: string,
  ): Promise<void> {
    const write = this.adapters.writeArchive ?? createBackupArchive;
    const sink = createWriteStream(archivePath, { mode: 0o600, flags: 'wx' });
    try {
      await write({
        database: this.database(),
        objects: this.sourceObjects(),
        sink,
        signingKey,
        context: {
          reason,
          appVersion: runningVersion(),
          databaseName: databaseName(env().DATABASE_URL),
        },
        workDir: this.adapters.workDir,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    }
  }

  private async enforceRetention(
    destination: ScheduledBackupDestination,
    settings: ScheduledBackupSettings,
  ): Promise<number> {
    const archives = await destination.list();
    const decision = selectScheduledBackupsToPrune(
      archives.map((archive) => ({ key: archive.key, timestamp: archive.lastModified })),
      settings.retention,
    );
    await destination.delete(decision.prune);
    return decision.prune.length;
  }

  private async resolveDestination(): Promise<{
    destination: ScheduledBackupDestination;
    dispose: () => void;
  }> {
    if (this.adapters.destination) {
      return { destination: this.adapters.destination, dispose: () => {} };
    }
    const override = await this.instanceConfig.getConfig('backup.destination');
    if (override) {
      const destination = destinationFromConnection(override);
      return { destination, dispose: () => destination.destroy() };
    }
    // The active snapshot's client is owned by the provider; never destroy it.
    return { destination: destinationFromSnapshot(this.clients.current()), dispose: () => {} };
  }

  private database(): DatabaseBackupEngine {
    if (this.adapters.database) return this.adapters.database;
    return new PgDatabaseBackupEngine({
      databaseUrl: env().DATABASE_URL,
      isInitialized: async () => (await this.prisma.instanceSettings.count()) > 0,
    });
  }

  private sourceObjects(): ObjectBackupStore {
    if (this.adapters.sourceObjects) return this.adapters.sourceObjects;
    const snapshot = this.clients.current();
    return new BackupExcludingObjectStore(
      new S3ObjectBackupStore(snapshot.internal, snapshot.bucket),
    );
  }
}
