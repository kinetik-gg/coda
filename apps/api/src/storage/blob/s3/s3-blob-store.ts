import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProbeCheck, StorageProbeCheckName } from '@coda/contracts';
import { env } from '../../../config/env';
import {
  BlobNotFoundError,
  type BlobDeleteOptions,
  type BlobGetOptions,
  type BlobGetResult,
  type BlobListEntry,
  type BlobListOptions,
  type BlobPutOptions,
  type BlobReadRequest,
  type BlobReadTarget,
  type BlobStat,
  type BlobStore,
  type BlobStoreCapabilities,
  type BlobUploadRequest,
  type BlobUploadTarget,
} from '../blob-store';

/** The capabilities every S3-compatible backend advertises: direct upload and signed reads. */
export const S3_BLOB_STORE_CAPABILITIES: BlobStoreCapabilities = {
  directUpload: true,
  presignedRead: true,
};

/** Per-network-operation timeout used by the direct-access CORS preflight. */
const PROBE_STEP_TIMEOUT_MS = 6_000;
/** Objects fetched per page while enumerating the bucket. */
const LIST_PAGE_SIZE = 1000;

/**
 * The immutable clients and coordinates backing one S3 backend. The provider
 * snapshots this per swap; an in-flight request keeps operating on the snapshot
 * it captured so a hot-swap never mixes a request across two backends.
 */
export interface S3BlobStoreSnapshot {
  readonly internal: S3Client;
  readonly publicClient: S3Client;
  readonly bucket: string;
  readonly endpoint: string;
  readonly publicEndpoint: string;
  readonly forcePathStyle: boolean;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

function probeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 480);
  return String(error).slice(0, 480);
}

/**
 * The S3 driver — the sole home of presigning and the AWS SDK. It is a
 * behaviour-identical refactor of the storage code that used to call the SDK
 * inline; the integration suite is the proof of byte-identity.
 */
export class S3BlobStore implements BlobStore {
  readonly capabilities = S3_BLOB_STORE_CAPABILITIES;

  /**
   * @param ownsClients transient stores built for a migration target or wizard
   *   probe own their clients and destroy them on {@link dispose}; the active
   *   store borrows the provider's clients and leaves them for the provider to
   *   retire.
   */
  constructor(
    private readonly snapshot: S3BlobStoreSnapshot,
    private readonly ownsClients: boolean,
  ) {}

  async init(): Promise<void> {
    const { internal, bucket } = this.snapshot;
    try {
      await internal.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await internal.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }

  async healthcheck(): Promise<void> {
    const { internal, bucket } = this.snapshot;
    await internal.send(new HeadBucketCommand({ Bucket: bucket }));
  }

  async createUpload(key: string, request: BlobUploadRequest): Promise<BlobUploadTarget> {
    const expiresIn = env().SIGNED_UPLOAD_TTL_SECONDS;
    const url = await getSignedUrl(
      this.snapshot.publicClient,
      new PutObjectCommand({
        Bucket: this.snapshot.bucket,
        Key: key,
        ContentType: request.contentType,
        ContentLength: request.contentLength,
        IfNoneMatch: '*',
      }),
      { expiresIn },
    );
    return { url, expiresIn };
  }

  async createReadUrl(key: string, request: BlobReadRequest): Promise<BlobReadTarget> {
    const expiresIn = env().SIGNED_READ_TTL_SECONDS;
    const url = await getSignedUrl(
      this.snapshot.publicClient,
      new GetObjectCommand({
        Bucket: this.snapshot.bucket,
        Key: key,
        ResponseContentDisposition: request.disposition,
        ResponseContentType: request.contentType,
      }),
      { expiresIn },
    );
    return { url, expiresIn };
  }

  async put(key: string, body: Readable, options: BlobPutOptions): Promise<void> {
    await this.snapshot.internal.send(
      new PutObjectCommand({
        Bucket: this.snapshot.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        IfNoneMatch: options.ifNoneMatch ? '*' : undefined,
      }),
      options.abortSignal ? { abortSignal: options.abortSignal } : {},
    );
  }

  async get(key: string, options: BlobGetOptions = {}): Promise<BlobGetResult> {
    try {
      const response = await this.snapshot.internal.send(
        new GetObjectCommand({
          Bucket: this.snapshot.bucket,
          Key: key,
          Range: options.range ? rangeHeader(options.range) : undefined,
        }),
        options.abortSignal ? { abortSignal: options.abortSignal } : {},
      );
      return { stream: (response.Body as Readable | undefined) ?? Readable.from([]) };
    } catch (error) {
      if (isMissing(error)) throw new BlobNotFoundError(key);
      throw error;
    }
  }

  async stat(key: string): Promise<BlobStat> {
    try {
      const head = await this.snapshot.internal.send(
        new HeadObjectCommand({ Bucket: this.snapshot.bucket, Key: key }),
      );
      return { size: head.ContentLength, contentType: head.ContentType };
    } catch (error) {
      if (isMissing(error)) throw new BlobNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string, options: BlobDeleteOptions = {}): Promise<void> {
    await this.snapshot.internal.send(
      new DeleteObjectCommand({ Bucket: this.snapshot.bucket, Key: key }),
      options.abortSignal ? { abortSignal: options.abortSignal } : {},
    );
  }

  async list(options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    const entries: BlobListEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.snapshot.internal.send(
        new ListObjectsV2Command({
          Bucket: this.snapshot.bucket,
          Prefix: options.prefix,
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

  async probeDirectAccess(key: string, deadline: AbortSignal): Promise<StorageProbeCheck[]> {
    const checks: StorageProbeCheck[] = [];
    await this.probePresign(key, checks);
    await this.probeCors(key, checks, deadline);
    return checks;
  }

  private async probePresign(key: string, checks: StorageProbeCheck[]): Promise<void> {
    try {
      const url = await getSignedUrl(
        this.snapshot.publicClient,
        new GetObjectCommand({ Bucket: this.snapshot.bucket, Key: key }),
        { expiresIn: 60 },
      );
      const parsed = new URL(url);
      const publicOrigin = new URL(this.snapshot.publicEndpoint).origin;
      const isSigned = ['X-Amz-Signature', 'Signature'].some((name) =>
        parsed.searchParams.has(name),
      );
      if (parsed.origin !== publicOrigin || !isSigned) {
        this.fail(
          checks,
          'presign',
          'Generated a URL but it did not target the public endpoint with a signature.',
        );
        return;
      }
      this.pass(checks, 'presign', 'Generated a signed URL on the public endpoint.');
    } catch (error) {
      this.fail(checks, 'presign', `Could not generate a signed URL: ${probeMessage(error)}.`);
    }
  }

  private async probeCors(
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    const appOrigin = env().APP_ORIGIN;
    const target = this.objectUrl(key);
    try {
      const response = await fetch(target, {
        method: 'OPTIONS',
        headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'GET' },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(PROBE_STEP_TIMEOUT_MS)]),
      });
      const allowed = response.headers.get('access-control-allow-origin');
      if (allowed === appOrigin || allowed === '*') {
        this.pass(checks, 'cors', `The backend allows browser requests from ${appOrigin}.`);
        return;
      }
      this.fail(
        checks,
        'cors',
        `The backend did not allow ${appOrigin} (got ${allowed ?? 'no CORS header'}). Configure the provider CORS policy for this origin.`,
      );
    } catch (error) {
      this.fail(
        checks,
        'cors',
        `Could not verify CORS against ${appOrigin}: ${probeMessage(error)}.`,
      );
    }
  }

  private objectUrl(key: string): string {
    const { endpoint, bucket, forcePathStyle } = this.snapshot;
    const base = new URL(endpoint);
    const path = forcePathStyle
      ? `${base.pathname.replace(/\/$/u, '')}/${bucket}/${key}`
      : `/${key}`;
    if (!forcePathStyle) base.hostname = `${bucket}.${base.hostname}`;
    base.pathname = path;
    return base.toString();
  }

  dispose(): void {
    if (!this.ownsClients) return;
    this.snapshot.internal.destroy();
    this.snapshot.publicClient.destroy();
  }

  private pass(checks: StorageProbeCheck[], name: StorageProbeCheckName, detail: string): void {
    checks.push({ name, ok: true, detail });
  }

  private fail(checks: StorageProbeCheck[], name: StorageProbeCheckName, detail: string): void {
    checks.push({ name, ok: false, detail });
  }
}

function rangeHeader(range: { start: number; end?: number }): string {
  return `bytes=${range.start}-${range.end ?? ''}`;
}
