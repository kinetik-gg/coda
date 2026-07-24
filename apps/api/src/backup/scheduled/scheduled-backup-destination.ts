import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageConnectionInput } from '@coda/contracts';
import type { S3BackendSnapshot } from '../../storage/blob/s3/s3-blob-store.provider';
import type { ObjectBackupStore, ObjectStoreEntry } from '../backup-ports';

/** Prefix, in every destination bucket, under which scheduled archives live. */
export const SCHEDULED_BACKUP_PREFIX = 'backups/scheduled/';

const LIST_PAGE_SIZE = 1000;
/** S3 DeleteObjects accepts at most 1000 keys per request. */
const DELETE_BATCH_SIZE = 1000;

/** One stored scheduled archive discovered in the destination bucket. */
export interface ScheduledArchive {
  key: string;
  size: number;
  lastModified: Date;
}

/** Builds a collision-resistant, chronologically sortable archive key. */
export function scheduledArchiveKey(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  return `${SCHEDULED_BACKUP_PREFIX}coda-backup-${stamp}-${randomBytes(4).toString('hex')}.codabackup`;
}

/**
 * The object-storage side of a scheduled-backup destination: the S3 client,
 * bucket, and coordinates for writing archives, enumerating them, and pruning.
 * Resolved per operation from the active storage snapshot or a dedicated
 * override so a hot-swap of primary storage never leaks into an in-flight run.
 */
export class ScheduledBackupDestination {
  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
    readonly endpoint: string,
    readonly forcePathStyle: boolean,
  ) {}

  /** Streams a staged archive file to the destination under the scheduled prefix. */
  async upload(key: string, path: string, size: number): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  /** Lists every scheduled archive currently stored in the destination bucket. */
  async list(): Promise<ScheduledArchive[]> {
    const archives: ScheduledArchive[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: SCHEDULED_BACKUP_PREFIX,
          MaxKeys: LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (!object.Key || object.Key.endsWith('/')) continue;
        archives.push({
          key: object.Key,
          size: Number(object.Size ?? 0),
          lastModified: object.LastModified ?? new Date(0),
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return archives;
  }

  /** Deletes the given archive keys, batched to the S3 per-request limit. */
  async delete(keys: readonly string[]): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
      const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
      if (batch.length === 0) continue;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}

/** Builds a destination backed by the currently active primary storage. */
export function destinationFromSnapshot(snapshot: S3BackendSnapshot): ScheduledBackupDestination {
  return new ScheduledBackupDestination(
    snapshot.internal,
    snapshot.bucket,
    snapshot.endpoint,
    snapshot.forcePathStyle,
  );
}

/** Builds a destination backed by a dedicated override connection. */
export function destinationFromConnection(
  connection: StorageConnectionInput,
): ScheduledBackupDestination {
  const client = new S3Client({
    region: connection.region,
    forcePathStyle: connection.forcePathStyle,
    endpoint: connection.endpoint,
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey,
    },
  });
  return new ScheduledBackupDestination(
    client,
    connection.bucket,
    connection.endpoint,
    connection.forcePathStyle,
  );
}

/**
 * Wraps a source object store so that stored backup archives are never folded
 * back into a new backup. Without this, writing scheduled archives to the same
 * bucket as primary storage would archive prior archives, compounding on every
 * run. Only enumeration is filtered; individual object access is untouched.
 */
export class BackupExcludingObjectStore implements ObjectBackupStore {
  constructor(private readonly inner: ObjectBackupStore) {}

  bucket(): string {
    return this.inner.bucket();
  }

  isEmpty(): Promise<boolean> {
    return this.inner.isEmpty();
  }

  async list(): Promise<ObjectStoreEntry[]> {
    const entries = await this.inner.list();
    return entries.filter((entry) => !entry.key.startsWith(SCHEDULED_BACKUP_PREFIX));
  }

  downloadTo(key: string, path: string): Promise<void> {
    return this.inner.downloadTo(key, path);
  }

  upload(key: string, path: string, size: number): Promise<void> {
    return this.inner.upload(key, path, size);
  }
}
