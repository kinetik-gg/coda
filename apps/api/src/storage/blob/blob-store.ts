import type { Readable } from 'node:stream';
import type { BlobStoreCapabilities, StorageProbeCheck } from '@coda/contracts';

export type { BlobStoreCapabilities } from '@coda/contracts';

/**
 * Object metadata a backend must retain. S3 keeps `contentType` on the object
 * implicitly; a filesystem backend must persist it in a sidecar to honour this.
 */
export interface BlobStat {
  /** Object size in bytes, or `undefined` when the backend omitted it on stat. */
  size: number | undefined;
  /** Stored content type, or `undefined` when the backend omitted it. */
  contentType: string | undefined;
}

/** A half-open byte range for a streaming read (`start` inclusive, `end` inclusive, S3 semantics). */
export interface BlobRange {
  start: number;
  end?: number;
}

export interface BlobGetOptions {
  /** Ranged read (`bytes=start-end`); omit for the full object. */
  range?: BlobRange;
  /** Aborts a long streaming read (e.g. the page-count worker's 120s ceiling). */
  abortSignal?: AbortSignal;
}

/** A streaming read handle. Callers consume `stream` and never buffer whole objects. */
export interface BlobGetResult {
  stream: Readable;
}

export interface BlobPutOptions {
  contentType: string;
  /** Declared length; drivers may use it as an upload bound. */
  contentLength?: number;
  /**
   * Aborts the write once more than `maxBytes` have been seen mid-stream, so a
   * backend that cannot lean on a presigned `ContentLength` still enforces the
   * per-object ceiling. Backends that bound by `contentLength` may ignore it.
   */
  maxBytes?: number;
  /** Conditional create: fail if the key already exists (S3 `If-None-Match: *`). */
  ifNoneMatch?: boolean;
  /** Aborts the write (used to bound the wizard probe). */
  abortSignal?: AbortSignal;
}

export interface BlobDeleteOptions {
  /** Aborts the delete (used to bound the wizard probe). */
  abortSignal?: AbortSignal;
}

/** A URL the client uploads to, plus its lifetime. Direct (presigned) or app-proxied. */
export interface BlobUploadTarget {
  url: string;
  expiresIn: number;
}

/** A URL the client reads from, plus its lifetime. */
export interface BlobReadTarget {
  url: string;
  expiresIn: number;
}

export interface BlobUploadRequest {
  contentType: string;
  contentLength: number;
}

export interface BlobReadRequest {
  /** `Content-Disposition` the download should carry. */
  disposition: string;
  /** `Content-Type` the download should carry. */
  contentType: string;
}

/** One listed object. */
export interface BlobListEntry {
  key: string;
  size: number;
}

export interface BlobListOptions {
  prefix?: string;
}

/**
 * A storage backend behind a capability-negotiated seam. The S3 driver is the
 * only implementation today; the FS driver (#75) implements the same contract.
 * Callers negotiate {@link capabilities} rather than assuming S3 semantics.
 */
export interface BlobStore {
  readonly capabilities: BlobStoreCapabilities;

  /** Prepares the backend for use (S3: create the bucket if missing). Idempotent. */
  init(): Promise<void>;
  /** Confirms the backend is reachable and writable (S3: HEAD bucket). */
  healthcheck(): Promise<void>;

  /**
   * Issues an upload target for `key`. Direct-upload backends return a presigned
   * PUT; proxied backends return an app URL. The client PUTs to it identically.
   */
  createUpload(key: string, request: BlobUploadRequest): Promise<BlobUploadTarget>;

  /** Issues a read target for `key` (direct backends: a presigned GET). */
  createReadUrl(key: string, request: BlobReadRequest): Promise<BlobReadTarget>;

  /** Streams bytes into `key`. Supports conditional create and a mid-stream `maxBytes` abort. */
  put(key: string, body: Readable, options: BlobPutOptions): Promise<void>;

  /** Opens a ranged, streaming read of `key`. Throws {@link BlobNotFoundError} when absent. */
  get(key: string, options?: BlobGetOptions): Promise<BlobGetResult>;

  /** Returns `{ size, contentType }` for `key`. Throws {@link BlobNotFoundError} when absent. */
  stat(key: string): Promise<BlobStat>;

  /** Removes `key`. Idempotent from the caller's perspective. */
  delete(key: string, options?: BlobDeleteOptions): Promise<void>;

  /** Lists objects, optionally under a prefix, sorted ascending by key. */
  list(options?: BlobListOptions): Promise<BlobListEntry[]>;

  /**
   * Direct-access probe for the settings wizard: signed-URL generation and the
   * browser CORS preflight. Only meaningful when `capabilities.directUpload`, so
   * the S3/presign specifics never leak outside the driver. `deadline` bounds the
   * network preflight.
   */
  probeDirectAccess?(key: string, deadline: AbortSignal): Promise<StorageProbeCheck[]>;

  /** Releases backend resources (transient stores built for a migration/probe). */
  dispose(): void;
}

/** Thrown by {@link BlobStore.get}/{@link BlobStore.stat} when the key is absent. */
export class BlobNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Blob not found: ${key}`);
    this.name = 'BlobNotFoundError';
  }
}
