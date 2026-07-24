import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  StartStorageMigration,
  StorageMigrationMismatch,
  StorageMigrationReport,
  StorageMigrationStatus,
  StorageProbeResult,
} from '@coda/contracts';
import { STORAGE_MIGRATION_MAX_MISMATCHES } from '@coda/contracts';
import { InstanceConfigService } from '../config/instance-config.service';
import type { StorageMigrationState } from '../config/instance-config-codecs';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerAdvisoryLock } from '../scheduler/advisory-lock';
import { BlobNotFoundError, type BlobStore } from './blob/blob-store';
import { S3BlobStoreProvider } from './blob/s3/s3-blob-store.provider';
import { StorageValidationService } from './storage-validation.service';

const MIGRATION_CONFIG_KEY = 'storage.migration' as const;
/** Advisory-lock key: shares the scheduler's singleton-guard lock space. */
const MIGRATION_LOCK_KEY = 'storage.migration';
/** Objects fetched per database page while copying or verifying. */
const BATCH_SIZE = 25;
/** Streaming copies/verifications run in flight at once within a batch. */
const COPY_CONCURRENCY = 4;
/** Ceiling on objects processed while the advisory lock is held in one tick. */
const MAX_OBJECTS_PER_TICK = 1_000;
/** Background cadence that resumes a migration after a crash or replica failover. */
const SAFETY_INTERVAL_MS = 10_000;

/** Outcome of a single driver tick, for logging and tests. */
export type MigrationTick = 'idle' | 'advanced' | 'contended' | 'skipped';

/** The result of an owner request to begin a migration. */
export interface StartMigrationResult {
  status: 'started' | 'invalid';
  probe: StorageProbeResult;
  migration?: StorageMigrationStatus;
}

interface MigrationObject {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** The id of the last object in a non-empty batch, falling back to the prior cursor. */
function lastId(batch: MigrationObject[], fallback: string | null): string | null {
  return batch[batch.length - 1]?.id ?? fallback;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

/**
 * Owner-triggered verified object migration.
 *
 * Streams every referenced {@link StorageService} object from the active backend
 * to a probe-validated target with bounded concurrency, checkpointing its cursor
 * in the encrypted config store so it resumes exactly where it left off after a
 * crash or failover. A verification pass then compares object count, per-object
 * size (against the database record) and a source↔target checksum, writing a
 * report. Cutover is a separate, explicit owner action that is refused unless the
 * report is complete and clean; until then — and after — the source backend is
 * left untouched, so an interrupted migration always leaves the instance serving
 * from the source.
 *
 * Exactly-once under replicas comes from running each advancing tick inside the
 * scheduler's Postgres advisory lock: only the lock holder makes progress, and a
 * crashed holder drops the lock so another replica resumes from the checkpoint.
 */
@Injectable()
export class StorageMigrationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StorageMigrationService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly instanceConfig: InstanceConfigService,
    private readonly blobs: S3BlobStoreProvider,
    private readonly validation: StorageValidationService,
    private readonly lock: SchedulerAdvisoryLock,
  ) {}

  onApplicationBootstrap(): void {
    // Resume any migration left in progress by a prior process, and act as the
    // failover safety net for one started on another replica.
    this.triggerTick();
    this.timer = setInterval(() => this.triggerTick(), SAFETY_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Redacted current migration state, or the idle state when none exists. */
  async status(userId: string): Promise<StorageMigrationStatus> {
    await this.assertAdministrator(userId);
    return this.toStatus(await this.instanceConfig.getConfig(MIGRATION_CONFIG_KEY));
  }

  /**
   * Probes the target and, on success, records a fresh migration and kicks off
   * the driver. Never touches the active backend. A failing probe persists
   * nothing.
   */
  async start(userId: string, input: StartStorageMigration): Promise<StartMigrationResult> {
    await this.assertAdministrator(userId);
    const probe = await this.validation.probe(input);
    if (!probe.ok) return { status: 'invalid', probe };

    const totals = await this.prisma.storageObject.aggregate({
      where: { status: 'READY', deletedAt: null },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    const state: StorageMigrationState = {
      phase: 'copying',
      target: input,
      sourceBucket: this.blobs.activeBucket(),
      copyCursor: null,
      verifyCursor: null,
      copiedObjects: 0,
      copiedBytes: 0,
      verifiedObjects: 0,
      totalObjects: totals._count.id,
      totalBytes: Number(totals._sum.sizeBytes ?? 0n),
      mismatches: [],
      startedAt: nowIso(),
      updatedAt: nowIso(),
      reportGeneratedAt: null,
      error: null,
    };
    await this.instanceConfig.setConfig(MIGRATION_CONFIG_KEY, state, userId);
    this.logger.log(
      `Storage migration started by ${userId} to bucket ${input.bucket} (${state.totalObjects} objects)`,
    );
    this.triggerTick();
    return { status: 'started', probe, migration: this.toStatus(state) };
  }

  /**
   * Switches the active backend to the migrated target via the same persist +
   * hot-swap path the wizard uses. Refused unless verification is complete and
   * clean, so cutover is impossible while any object is missing or mismatched.
   * The source backend is left untouched for the operator to delete later.
   */
  async cutover(userId: string): Promise<StorageMigrationStatus> {
    await this.assertAdministrator(userId);
    const state = await this.instanceConfig.getConfig(MIGRATION_CONFIG_KEY);
    if (!state) throw new NotFoundException('No migration is in progress');
    if (!this.canCutover(state)) {
      throw new ConflictException(
        'Cutover is blocked until every object has been verified with no mismatches',
      );
    }
    // The target bucket already holds every migrated, verified object, so it
    // exists — no ensureBucket needed. Persist then hot-swap, exactly as the
    // wizard's apply path does; the source backend is left untouched.
    await this.instanceConfig.setConfig('storage.connection', state.target, userId);
    this.blobs.swap(state.target);
    const next: StorageMigrationState = { ...state, phase: 'cutover', updatedAt: nowIso() };
    await this.instanceConfig.setConfig(MIGRATION_CONFIG_KEY, next, userId);
    this.logger.log(`Storage migration cut over to bucket ${state.target.bucket} by ${userId}`);
    return this.toStatus(next);
  }

  /** Discards the migration record so the operator can start over. Source untouched. */
  async cancel(userId: string): Promise<StorageMigrationStatus> {
    await this.assertAdministrator(userId);
    await this.instanceConfig.deleteConfig(MIGRATION_CONFIG_KEY);
    this.logger.log(`Storage migration cancelled by ${userId}`);
    return this.toStatus(undefined);
  }

  private triggerTick(): void {
    void this.tick().catch((error: unknown) => {
      this.logger.error(`Storage migration tick failed: ${errorMessage(error)}`);
    });
  }

  /**
   * One driver tick. Cheaply no-ops when no migration exists, otherwise advances
   * it under the advisory lock so only one replica ever makes progress at a time.
   */
  async tick(): Promise<MigrationTick> {
    if (this.ticking) return 'skipped';
    this.ticking = true;
    try {
      if (!(await this.instanceConfig.hasConfig(MIGRATION_CONFIG_KEY))) return 'idle';
      const attempt = await this.lock.runExclusively(MIGRATION_LOCK_KEY, () => this.advance());
      return attempt.acquired ? 'advanced' : 'contended';
    } finally {
      this.ticking = false;
    }
  }

  /** Advances the migration by bounded batches until it stalls or the tick budget is spent. */
  private async advance(): Promise<void> {
    let processed = 0;
    while (processed < MAX_OBJECTS_PER_TICK) {
      const state = await this.instanceConfig.getConfig(MIGRATION_CONFIG_KEY);
      if (!state) return;
      try {
        if (state.phase === 'copying') {
          processed += await this.copyBatch(state);
        } else if (state.phase === 'verifying') {
          processed += await this.verifyBatch(state);
        } else {
          return;
        }
      } catch (error) {
        await this.fail(state, errorMessage(error));
        return;
      }
    }
  }

  private async copyBatch(state: StorageMigrationState): Promise<number> {
    const batch = await this.nextObjects(state.copyCursor);
    if (batch.length === 0) {
      await this.save({
        ...state,
        phase: 'verifying',
        verifyCursor: null,
        verifiedObjects: 0,
        mismatches: [],
      });
      return 0;
    }
    const target = this.blobs.forConnection(state.target);
    try {
      const source = this.blobs.active();
      let copiedBytes = 0;
      await this.eachBounded(batch, async (object) => {
        const { stream } = await source.get(object.objectKey);
        await target.put(object.objectKey, stream, {
          contentType: object.mimeType,
          contentLength: Number(object.sizeBytes),
        });
        copiedBytes += Number(object.sizeBytes);
      });
      await this.save({
        ...state,
        copyCursor: lastId(batch, state.copyCursor),
        copiedObjects: state.copiedObjects + batch.length,
        copiedBytes: state.copiedBytes + copiedBytes,
      });
    } finally {
      target.dispose();
    }
    return batch.length;
  }

  private async verifyBatch(state: StorageMigrationState): Promise<number> {
    const batch = await this.nextObjects(state.verifyCursor);
    if (batch.length === 0) {
      await this.save({ ...state, phase: 'verified', reportGeneratedAt: nowIso() });
      this.logger.log(
        `Storage migration verified ${state.verifiedObjects}/${state.totalObjects} objects with ${state.mismatches.length} mismatch(es)`,
      );
      return 0;
    }
    const target = this.blobs.forConnection(state.target);
    try {
      const source = this.blobs.active();
      const mismatches: StorageMigrationMismatch[] = [];
      await this.eachBounded(batch, async (object) => {
        const found = await this.verifyObject(source, target, object);
        if (found) mismatches.push(found);
      });
      const merged = [...state.mismatches, ...mismatches].slice(
        0,
        STORAGE_MIGRATION_MAX_MISMATCHES,
      );
      await this.save({
        ...state,
        verifyCursor: lastId(batch, state.verifyCursor),
        verifiedObjects: state.verifiedObjects + batch.length,
        mismatches: merged,
      });
    } finally {
      target.dispose();
    }
    return batch.length;
  }

  private async verifyObject(
    source: BlobStore,
    target: BlobStore,
    object: MigrationObject,
  ): Promise<StorageMigrationMismatch | null> {
    const expected = Number(object.sizeBytes);
    const sourceDigest = await this.digest(source, object.objectKey);
    const targetDigest = await this.digest(target, object.objectKey);
    if (!targetDigest) {
      return { objectKey: object.objectKey, kind: 'missing', detail: 'Absent from the target' };
    }
    if (targetDigest.bytes !== expected) {
      return {
        objectKey: object.objectKey,
        kind: 'size',
        detail: `Target is ${targetDigest.bytes} bytes; database records ${expected}`,
      };
    }
    if (!sourceDigest) {
      return { objectKey: object.objectKey, kind: 'error', detail: 'Unreadable at the source' };
    }
    if (sourceDigest.sha !== targetDigest.sha) {
      return {
        objectKey: object.objectKey,
        kind: 'checksum',
        detail: 'Checksum differs from source',
      };
    }
    return null;
  }

  private async digest(
    store: BlobStore,
    key: string,
  ): Promise<{ sha: string; bytes: number } | null> {
    try {
      const { stream } = await store.get(key);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of stream) {
        const buffer = chunk as Buffer;
        hash.update(buffer);
        bytes += buffer.length;
      }
      return { sha: hash.digest('hex'), bytes };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  private nextObjects(cursor: string | null): Promise<MigrationObject[]> {
    return this.prisma.storageObject.findMany({
      where: { status: 'READY', deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, objectKey: true, mimeType: true, sizeBytes: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
  }

  private async eachBounded<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
    let index = 0;
    const workers = Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        if (current !== undefined) await task(current);
      }
    });
    await Promise.all(workers);
  }

  private save(state: StorageMigrationState): Promise<void> {
    return this.instanceConfig.setConfig(MIGRATION_CONFIG_KEY, { ...state, updatedAt: nowIso() });
  }

  private async fail(state: StorageMigrationState, error: string): Promise<void> {
    this.logger.error(`Storage migration failed: ${error}`);
    await this.save({ ...state, phase: 'failed', error });
  }

  private canCutover(state: StorageMigrationState): boolean {
    return (
      state.phase === 'verified' &&
      state.mismatches.length === 0 &&
      state.verifiedObjects === state.totalObjects
    );
  }

  private buildReport(state: StorageMigrationState): StorageMigrationReport | null {
    if (!state.reportGeneratedAt) return null;
    return {
      generatedAt: state.reportGeneratedAt,
      totalObjects: state.totalObjects,
      verifiedObjects: state.verifiedObjects,
      totalBytes: state.totalBytes,
      mismatches: state.mismatches,
    };
  }

  private toStatus(state: StorageMigrationState | undefined): StorageMigrationStatus {
    if (!state) {
      return {
        phase: 'idle',
        target: null,
        copiedObjects: 0,
        totalObjects: 0,
        copiedBytes: 0,
        totalBytes: 0,
        verifiedObjects: 0,
        startedAt: null,
        updatedAt: null,
        error: null,
        report: null,
        canCutover: false,
      };
    }
    return {
      phase: state.phase,
      target: {
        provider: state.target.provider,
        endpoint: state.target.endpoint,
        bucket: state.target.bucket,
      },
      copiedObjects: state.copiedObjects,
      totalObjects: state.totalObjects,
      copiedBytes: state.copiedBytes,
      totalBytes: state.totalBytes,
      verifiedObjects: state.verifiedObjects,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      error: state.error,
      report: this.buildReport(state),
      canCutover: this.canCutover(state),
    };
  }

  private async assertAdministrator(userId: string): Promise<void> {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may manage storage settings');
    }
  }
}
