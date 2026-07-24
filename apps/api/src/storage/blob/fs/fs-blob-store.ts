import { createReadStream } from 'node:fs';
import {
  access,
  constants as fsConstants,
  link,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { BlobStoreCapabilities } from '@coda/contracts';
import {
  BlobNotFoundError,
  type BlobGetOptions,
  type BlobGetResult,
  type BlobListEntry,
  type BlobListOptions,
  type BlobPutOptions,
  type BlobReadRequest,
  type BlobReadTarget,
  type BlobStat,
  type BlobStore,
  type BlobUploadRequest,
  type BlobUploadTarget,
} from '../blob-store';
import type { BlobProxySigner } from './blob-proxy-signer';

/** The filesystem driver proxies every transfer through the app; it signs nothing S3-shaped. */
export const FS_BLOB_STORE_CAPABILITIES: BlobStoreCapabilities = {
  directUpload: false,
  presignedRead: false,
};

const META_SUFFIX = '.meta.json';
/** One key segment: starts alphanumeric, then word/dot/dash. Forbids `.`/`..`, empty, and traversal. */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** Thrown when a key cannot be mapped to a safe path inside the configured root. */
export class BlobKeyError extends Error {
  constructor(readonly key: string) {
    super(`Unsafe blob key: ${key}`);
    this.name = 'BlobKeyError';
  }
}

/** Thrown mid-stream when a proxied upload exceeds its declared ceiling; the object is never written. */
export class BlobTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upload exceeds the ${maxBytes}-byte ceiling`);
    this.name = 'BlobTooLargeError';
  }
}

/** Thrown by a conditional create when the key already exists (mirrors S3 `If-None-Match: *`). */
export class BlobAlreadyExistsError extends Error {
  constructor(readonly key: string) {
    super(`Blob already exists: ${key}`);
    this.name = 'BlobAlreadyExistsError';
  }
}

interface SidecarMeta {
  size: number;
  contentType: string;
}

export interface FsBlobStoreOptions {
  root: string;
  signer: BlobProxySigner;
  appOrigin: string;
  uploadTtlSeconds: number;
  readTtlSeconds: number;
}

/**
 * A no-dependency, single-node {@link BlobStore} over a directory. Objects live at
 * `<root>/objects/<key>` with a `<key>.meta.json` sidecar carrying the content type
 * so {@link stat} answers `{size, contentType}` without sniffing bytes. Writes stage
 * into `<root>/tmp` and land by atomic rename (or hard-link for conditional create),
 * so a reader never observes a half-written or truncated object.
 */
export class FsBlobStore implements BlobStore {
  readonly capabilities = FS_BLOB_STORE_CAPABILITIES;

  private readonly objectsDir: string;
  private readonly tmpDir: string;

  constructor(private readonly options: FsBlobStoreOptions) {
    this.objectsDir = resolve(options.root, 'objects');
    this.tmpDir = resolve(options.root, 'tmp');
  }

  async init(): Promise<void> {
    await mkdir(this.objectsDir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  async healthcheck(): Promise<void> {
    await this.init();
    await access(this.objectsDir, fsConstants.W_OK);
  }

  createUpload(key: string, request: BlobUploadRequest): Promise<BlobUploadTarget> {
    const objectKey = this.assertKey(key).key;
    const expiresIn = this.options.uploadTtlSeconds;
    const token = this.options.signer.sign({
      op: 'put',
      key: objectKey,
      contentType: request.contentType,
      contentLength: request.contentLength,
      maxBytes: request.contentLength,
      exp: this.expiryAt(expiresIn),
    });
    return Promise.resolve({ url: this.proxyUrl('upload', token), expiresIn });
  }

  createReadUrl(key: string, request: BlobReadRequest): Promise<BlobReadTarget> {
    const objectKey = this.assertKey(key).key;
    const expiresIn = this.options.readTtlSeconds;
    const token = this.options.signer.sign({
      op: 'get',
      key: objectKey,
      disposition: request.disposition,
      contentType: request.contentType,
      exp: this.expiryAt(expiresIn),
    });
    return Promise.resolve({ url: this.proxyUrl('download', token), expiresIn });
  }

  async put(key: string, body: Readable, options: BlobPutOptions): Promise<void> {
    const { objectPath, metaPath } = this.assertKey(key);
    await mkdir(dirname(objectPath), { recursive: true });
    const stagePath = join(this.tmpDir, randomUUID());
    let bytesWritten = 0;
    const handle = await open(stagePath, 'wx');
    try {
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        bytesWritten += buffer.byteLength;
        if (options.maxBytes !== undefined && bytesWritten > options.maxBytes) {
          throw new BlobTooLargeError(options.maxBytes);
        }
        await handle.write(buffer);
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(stagePath, { force: true });
      throw error;
    }
    await handle.close();
    await this.commit(key, stagePath, objectPath, metaPath, options);
  }

  async get(key: string, options: BlobGetOptions = {}): Promise<BlobGetResult> {
    const { objectPath } = this.assertKey(key);
    const size = await this.objectSize(key, objectPath);
    const range = options.range;
    if (range && range.start >= size) return { stream: Readable.from([]) };
    const start = range?.start ?? 0;
    const end = range?.end !== undefined ? Math.min(range.end, size - 1) : undefined;
    const stream = createReadStream(objectPath, {
      start,
      ...(end !== undefined ? { end } : {}),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    return { stream };
  }

  async stat(key: string): Promise<BlobStat> {
    const { objectPath, metaPath } = this.assertKey(key);
    const [size, meta] = await Promise.all([
      this.objectSize(key, objectPath),
      this.readMeta(key, metaPath),
    ]);
    return { size, contentType: meta.contentType };
  }

  async delete(key: string): Promise<void> {
    const { objectPath, metaPath } = this.assertKey(key);
    await Promise.all([rm(objectPath, { force: true }), rm(metaPath, { force: true })]);
  }

  async list(options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    const entries: BlobListEntry[] = [];
    await this.walk(this.objectsDir, entries);
    const filtered = options.prefix
      ? entries.filter((entry) => entry.key.startsWith(options.prefix as string))
      : entries;
    filtered.sort((left, right) => left.key.localeCompare(right.key));
    return filtered;
  }

  dispose(): void {
    /* No pooled resources to release. */
  }

  private async commit(
    key: string,
    stagePath: string,
    objectPath: string,
    metaPath: string,
    options: BlobPutOptions,
  ): Promise<void> {
    try {
      if (options.ifNoneMatch) {
        await this.linkExclusive(key, stagePath, objectPath);
      } else {
        await rename(stagePath, objectPath);
      }
    } catch (error) {
      await rm(stagePath, { force: true });
      throw error;
    }
    // Object first, sidecar second: a crash between the two leaves an object with
    // no sidecar, which stat() reports as absent — never a phantom with metadata.
    try {
      await this.writeMeta(metaPath, {
        size: (await stat(objectPath)).size,
        contentType: options.contentType,
      });
    } catch (error) {
      await rm(objectPath, { force: true });
      throw error;
    }
  }

  private async linkExclusive(key: string, stagePath: string, objectPath: string): Promise<void> {
    try {
      await link(stagePath, objectPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new BlobAlreadyExistsError(key);
      }
      throw error;
    }
    await rm(stagePath, { force: true });
  }

  private async writeMeta(metaPath: string, meta: SidecarMeta): Promise<void> {
    const stagePath = join(this.tmpDir, `${randomUUID()}${META_SUFFIX}`);
    const handle = await open(stagePath, 'wx');
    try {
      await handle.write(JSON.stringify(meta));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(stagePath, metaPath);
  }

  private async readMeta(key: string, metaPath: string): Promise<SidecarMeta> {
    try {
      const handle = await open(metaPath, 'r');
      try {
        const raw = await handle.readFile('utf8');
        return JSON.parse(raw) as SidecarMeta;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BlobNotFoundError(key);
      throw error;
    }
  }

  private async objectSize(key: string, objectPath: string): Promise<number> {
    try {
      return (await stat(objectPath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BlobNotFoundError(key);
      throw error;
    }
  }

  private async walk(dir: string, entries: BlobListEntry[]): Promise<void> {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      const full = join(dir, dirEntry.name);
      if (dirEntry.isDirectory()) {
        await this.walk(full, entries);
        continue;
      }
      if (dirEntry.name.endsWith(META_SUFFIX)) continue;
      const key = relative(this.objectsDir, full).split(sep).join('/');
      entries.push({ key, size: (await stat(full)).size });
    }
  }

  private assertKey(key: string): { key: string; objectPath: string; metaPath: string } {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
      throw new BlobKeyError(String(key));
    }
    const segments = key.split('/');
    const safe = segments.every(
      (segment) => SEGMENT_PATTERN.test(segment) && !segment.endsWith(META_SUFFIX),
    );
    if (!safe) throw new BlobKeyError(key);
    const objectPath = resolve(this.objectsDir, key);
    if (objectPath !== this.objectsDir && !objectPath.startsWith(this.objectsDir + sep)) {
      throw new BlobKeyError(key);
    }
    return { key, objectPath, metaPath: `${objectPath}${META_SUFFIX}` };
  }

  private proxyUrl(route: 'upload' | 'download', token: string): string {
    return `${this.options.appOrigin}/api/v1/blob/${route}/${token}`;
  }

  private expiryAt(ttlSeconds: number): number {
    return Math.floor(Date.now() / 1_000) + ttlSeconds;
  }
}
