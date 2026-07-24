import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectBackupStore, ObjectStoreEntry } from './backup-ports';

const LIST_PAGE_SIZE = 1000;

/**
 * MinIO/S3 implementation of {@link ObjectBackupStore}. Downloads and uploads
 * stream directly between the staged tmpfs files and object storage, so no object
 * is ever fully buffered in memory.
 */
export class S3ObjectBackupStore implements ObjectBackupStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucketName: string,
  ) {}

  bucket(): string {
    return this.bucketName;
  }

  async isEmpty(): Promise<boolean> {
    const response = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucketName, MaxKeys: 1 }),
    );
    return (response.Contents?.length ?? 0) === 0;
  }

  async list(): Promise<ObjectStoreEntry[]> {
    const entries: ObjectStoreEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          MaxKeys: LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) entries.push({ key: object.Key, size: Number(object.Size ?? 0) });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    entries.sort((left, right) => left.key.localeCompare(right.key));
    return entries;
  }

  async downloadTo(key: string, path: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    if (!response.Body) throw new Error(`Object storage returned no body for ${key}`);
    await pipeline(
      response.Body as Readable,
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    );
  }

  async upload(key: string, path: string, size: number): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
      }),
    );
  }
}
