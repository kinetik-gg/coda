import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Writable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { createBackupArchive, restoreBackupArchive } from './backup-core';
import type { BackupManifest } from './backup-format';
import { PgDatabaseBackupEngine } from './backup-pg';
import type {
  BackupProgressListener,
  DatabaseBackupEngine,
  ObjectBackupStore,
} from './backup-ports';
import { S3ObjectBackupStore } from './backup-s3';

/**
 * Optional dependency-injection seam that lets tests substitute in-memory database
 * and object-store adapters without a live PostgreSQL or S3 endpoint.
 */
export const BACKUP_ADAPTERS = Symbol('BACKUP_ADAPTERS');

export interface BackupAdapters {
  database?: DatabaseBackupEngine;
  objects?: ObjectBackupStore;
}

export interface CreateBackupRequest {
  sink: Writable;
  signingKey: Buffer | string;
  reason: string;
  appVersion: string;
  composeProject?: string;
  onProgress?: BackupProgressListener;
}

export interface RestoreBackupRequest {
  source: AsyncIterable<Buffer>;
  verificationKey: Buffer | string;
  onProgress?: BackupProgressListener;
}

function databaseName(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//u, '')) || 'postgres';
  } catch {
    return 'postgres';
  }
}

/**
 * In-app backup engine. Wires the streaming create/restore core to the runtime's
 * PostgreSQL and object-storage adapters. UI and transport endpoints are delivered
 * separately; this service is the reusable service-layer surface.
 */
@Injectable()
export class BackupService {
  private client?: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BACKUP_ADAPTERS) private readonly adapters: BackupAdapters = {},
  ) {}

  create(request: CreateBackupRequest): Promise<BackupManifest> {
    return createBackupArchive({
      database: this.database(),
      objects: this.objects(),
      sink: request.sink,
      signingKey: request.signingKey,
      context: {
        reason: request.reason,
        appVersion: request.appVersion,
        databaseName: databaseName(env().DATABASE_URL),
        composeProject: request.composeProject,
      },
      onProgress: request.onProgress,
    });
  }

  restore(request: RestoreBackupRequest): Promise<BackupManifest> {
    return restoreBackupArchive({
      database: this.database(),
      objects: this.objects(),
      source: request.source,
      verificationKey: request.verificationKey,
      onProgress: request.onProgress,
    });
  }

  private database(): DatabaseBackupEngine {
    if (this.adapters.database) return this.adapters.database;
    return new PgDatabaseBackupEngine({
      databaseUrl: env().DATABASE_URL,
      isInitialized: async () => (await this.prisma.instanceSettings.count()) > 0,
    });
  }

  private objects(): ObjectBackupStore {
    if (this.adapters.objects) return this.adapters.objects;
    return new S3ObjectBackupStore(this.s3(), env().S3_BUCKET);
  }

  private s3(): S3Client {
    if (!this.client) {
      const config = env();
      this.client = new S3Client({
        region: config.S3_REGION,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
        endpoint: config.S3_ENDPOINT,
      });
    }
    return this.client;
  }
}
