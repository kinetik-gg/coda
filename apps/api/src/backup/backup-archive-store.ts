import { createReadStream } from 'node:fs';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { BACKUP_STORAGE_PREFIX } from './backup-s3';

const LIST_PAGE_SIZE = 1000;

/** Key prefix under which pre-upgrade safety archives are stored inside the active bucket. */
export const PRE_UPGRADE_BACKUP_PREFIX = `${BACKUP_STORAGE_PREFIX}pre-upgrade/`;

/**
 * Storage adapter for internal backup archives that live in the active object-storage bucket under
 * the reserved {@link BACKUP_STORAGE_PREFIX}. Unlike {@link S3ObjectBackupStore}, which streams the
 * application's own objects into and out of an archive, this store manages the finished archive files
 * themselves: it uploads a fully staged archive from a tmpfs path with a known content length and
 * prunes old archives so the safety history stays bounded.
 */
export class S3BackupArchiveStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucketName: string,
  ) {}

  /** Upload a staged archive file to the given key with an explicit content length. */
  async put(key: string, path: string, size: number): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
      }),
    );
  }

  /** List every archive key under a prefix, sorted ascending (timestamped keys sort oldest-first). */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    keys.sort();
    return keys;
  }

  /** Keep the newest `keep` archives under a prefix and delete the rest; returns the pruned keys. */
  async pruneToLast(prefix: string, keep: number): Promise<string[]> {
    const keys = await this.list(prefix);
    if (keys.length <= keep) return [];
    const stale = keys.slice(0, keys.length - keep);
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    return stale;
  }
}
