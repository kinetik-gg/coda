import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import type { StorageConfigSource, StorageProviderPreset } from '@coda/contracts';
import { env } from '../config/env';
import type { StorageConnection } from '../config/instance-config-codecs';
import { InstanceConfigService } from '../config/instance-config.service';

/**
 * The immutable set of clients and coordinates that back a single storage
 * backend. Consumers snapshot this per operation via {@link StorageClientProvider.current}
 * so a hot-swap mid-flight never mixes a request across two backends: an in-flight
 * request keeps operating on the snapshot it captured, while new requests resolve
 * the freshly swapped snapshot.
 */
export interface StorageClientSnapshot {
  readonly internal: S3Client;
  readonly publicClient: S3Client;
  readonly bucket: string;
  readonly region: string;
  readonly endpoint: string;
  readonly publicEndpoint: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly provider: StorageProviderPreset | null;
  readonly source: StorageConfigSource;
}

/** How long a retired backend's clients stay alive so in-flight requests drain. */
const RETIREMENT_GRACE_MS = 60_000;

/**
 * Owns the live S3 clients for the active object-storage backend and swaps them
 * in-process without a restart. Boots from the environment, then adopts a stored
 * configuration row if one exists. Every consumer resolves {@link current} per
 * call rather than capturing a client at construction, which is what lets
 * {@link swap} and {@link revertToEnv} redirect all subsequent traffic atomically.
 */
@Injectable()
export class StorageClientProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageClientProvider.name);
  private snapshot: StorageClientSnapshot;
  private readonly retirementTimers = new Set<NodeJS.Timeout>();

  constructor(private readonly instanceConfig: InstanceConfigService) {
    this.snapshot = this.buildFromEnv();
  }

  async onModuleInit(): Promise<void> {
    const stored = await this.instanceConfig.getConfig('storage.connection');
    if (stored) {
      this.snapshot = this.build(stored, 'config');
      this.logger.log(
        `Storage backend resolved from stored configuration (bucket ${stored.bucket})`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.retirementTimers) clearTimeout(timer);
    this.retirementTimers.clear();
    this.destroy(this.snapshot);
  }

  /** The active backend snapshot. Call once per operation, never cache long-term. */
  current(): StorageClientSnapshot {
    return this.snapshot;
  }

  /** Atomically redirects all subsequent operations to `connection`. */
  swap(connection: StorageConnection): StorageClientSnapshot {
    const previous = this.snapshot;
    this.snapshot = this.build(connection, 'config');
    this.retire(previous);
    this.logger.log(`Storage backend hot-swapped to bucket ${connection.bucket}`);
    return this.snapshot;
  }

  /** Restores the environment-provided backend and retires the override clients. */
  revertToEnv(): StorageClientSnapshot {
    const previous = this.snapshot;
    this.snapshot = this.buildFromEnv();
    this.retire(previous);
    this.logger.log('Storage backend reverted to environment configuration');
    return this.snapshot;
  }

  private buildFromEnv(): StorageClientSnapshot {
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
  ): StorageClientSnapshot {
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

  private retire(snapshot: StorageClientSnapshot): void {
    const timer = setTimeout(() => {
      this.retirementTimers.delete(timer);
      this.destroy(snapshot);
    }, RETIREMENT_GRACE_MS);
    timer.unref?.();
    this.retirementTimers.add(timer);
  }

  private destroy(snapshot: StorageClientSnapshot): void {
    snapshot.internal.destroy();
    snapshot.publicClient.destroy();
  }
}
