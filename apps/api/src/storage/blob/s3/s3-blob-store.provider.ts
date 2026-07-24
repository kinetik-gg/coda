import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import type {
  BlobStoreCapabilities,
  StorageConfigSource,
  StorageProviderPreset,
} from '@coda/contracts';
import { env } from '../../../config/env';
import type { StorageConnection } from '../../../config/instance-config-codecs';
import { InstanceConfigService } from '../../../config/instance-config.service';
import type { BlobStore } from '../blob-store';
import { S3_BLOB_STORE_CAPABILITIES, S3BlobStore, type S3BlobStoreSnapshot } from './s3-blob-store';

/**
 * A redacted description of the active backend for the settings screen. Carries
 * no clients and no secret key — only what the wizard renders.
 */
export interface StorageBackendDescriptor {
  source: StorageConfigSource;
  provider: StorageProviderPreset | null;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  forcePathStyle: boolean;
}

/**
 * The active backend: its live S3 clients plus the descriptor the wizard renders.
 * The backup engine resolves this per operation to reuse the active client and
 * bucket (see {@link S3BlobStoreProvider.current}); it structurally satisfies the
 * {@link S3BlobStoreSnapshot} the driver's blob store reads.
 */
export interface S3BackendSnapshot extends S3BlobStoreSnapshot {
  readonly region: string;
  readonly accessKeyId: string;
  readonly provider: StorageProviderPreset | null;
  readonly source: StorageConfigSource;
}

/** How long a retired backend's clients stay alive so in-flight requests drain. */
const RETIREMENT_GRACE_MS = 60_000;

/**
 * Owns the live S3 backend and swaps it in-process without a restart. Boots from
 * the environment, then adopts a stored configuration row if one exists. Callers
 * resolve {@link active} (or {@link forConnection} for a transient target) per
 * operation rather than caching, which is what lets {@link swap} and
 * {@link revertToEnv} redirect all subsequent traffic atomically.
 *
 * This provider and {@link S3BlobStore} are the S3 driver: the only code that
 * touches the AWS SDK or presigning. Every consumer works through {@link BlobStore}.
 */
@Injectable()
export class S3BlobStoreProvider implements OnModuleInit, OnModuleDestroy {
  readonly capabilities: BlobStoreCapabilities = S3_BLOB_STORE_CAPABILITIES;

  private readonly logger = new Logger(S3BlobStoreProvider.name);
  private backend: S3BackendSnapshot;
  private readonly retirementTimers = new Set<NodeJS.Timeout>();

  constructor(private readonly instanceConfig: InstanceConfigService) {
    this.backend = this.buildFromEnv();
  }

  async onModuleInit(): Promise<void> {
    const stored = await this.instanceConfig.getConfig('storage.connection');
    if (stored) {
      this.backend = this.build(stored, 'config');
      this.logger.log(
        `Storage backend resolved from stored configuration (bucket ${stored.bucket})`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.retirementTimers) clearTimeout(timer);
    this.retirementTimers.clear();
    this.destroy(this.backend);
  }

  /** A {@link BlobStore} over the active backend. Call once per operation, never cache. */
  active(): BlobStore {
    return new S3BlobStore(this.backend, false);
  }

  /**
   * A transient {@link BlobStore} over `connection` (a migration target or a
   * wizard-probe candidate). It owns its clients; the caller must
   * {@link BlobStore.dispose} it.
   */
  forConnection(connection: StorageConnection): BlobStore {
    return new S3BlobStore(this.build(connection, 'config'), true);
  }

  /** Redacted description of the active backend for the settings view. */
  describe(): StorageBackendDescriptor {
    const {
      source,
      provider,
      endpoint,
      publicEndpoint,
      region,
      bucket,
      accessKeyId,
      forcePathStyle,
    } = this.backend;
    return {
      source,
      provider,
      endpoint,
      publicEndpoint,
      region,
      bucket,
      accessKeyId,
      forcePathStyle,
    };
  }

  /** The active bucket name (used by the migration job to record the source). */
  activeBucket(): string {
    return this.backend.bucket;
  }

  /**
   * The active backend snapshot, including its live S3 clients. Reserved for the
   * backup engine, whose own {@link import('../../../backup/backup-ports').ObjectBackupStore}
   * driver streams whole objects to/from staged archive files — a contract wider
   * than {@link BlobStore}. Call once per operation; never cache the clients.
   */
  current(): S3BackendSnapshot {
    return this.backend;
  }

  /** Atomically redirects all subsequent operations to `connection`. */
  swap(connection: StorageConnection): void {
    const previous = this.backend;
    this.backend = this.build(connection, 'config');
    this.retire(previous);
    this.logger.log(`Storage backend hot-swapped to bucket ${connection.bucket}`);
  }

  /** Restores the environment-provided backend and retires the override clients. */
  revertToEnv(): void {
    const previous = this.backend;
    this.backend = this.buildFromEnv();
    this.retire(previous);
    this.logger.log('Storage backend reverted to environment configuration');
  }

  private buildFromEnv(): S3BackendSnapshot {
    const config = env();
    return this.build(
      {
        provider: null,
        endpoint: config.S3_ENDPOINT,
        publicEndpoint: config.S3_PUBLIC_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
      },
      'env',
    );
  }

  private build(
    connection: Omit<StorageConnection, 'provider'> & { provider: StorageProviderPreset | null },
    source: StorageConfigSource,
  ): S3BackendSnapshot {
    const common = {
      region: connection.region,
      forcePathStyle: connection.forcePathStyle,
      credentials: {
        accessKeyId: connection.accessKeyId,
        secretAccessKey: connection.secretAccessKey,
      },
    };
    return {
      internal: new S3Client({ ...common, endpoint: connection.endpoint }),
      publicClient: new S3Client({ ...common, endpoint: connection.publicEndpoint }),
      bucket: connection.bucket,
      region: connection.region,
      endpoint: connection.endpoint,
      publicEndpoint: connection.publicEndpoint,
      forcePathStyle: connection.forcePathStyle,
      accessKeyId: connection.accessKeyId,
      provider: connection.provider ?? null,
      source,
    };
  }

  private retire(backend: S3BackendSnapshot): void {
    const timer = setTimeout(() => {
      this.retirementTimers.delete(timer);
      this.destroy(backend);
    }, RETIREMENT_GRACE_MS);
    timer.unref?.();
    this.retirementTimers.add(timer);
  }

  private destroy(backend: S3BackendSnapshot): void {
    backend.internal.destroy();
    backend.publicClient.destroy();
  }
}
