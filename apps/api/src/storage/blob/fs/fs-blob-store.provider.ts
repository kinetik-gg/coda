import { Injectable } from '@nestjs/common';
import type { BlobStoreCapabilities } from '@coda/contracts';
import { env } from '../../../config/env';
import type { BlobStore } from '../blob-store';
import { BlobProxySigner, type DownloadGrant, type UploadGrant } from './blob-proxy-signer';
import { FS_BLOB_STORE_CAPABILITIES, FsBlobStore } from './fs-blob-store';

/**
 * Owns the filesystem driver: the object root, the TTLs, and the per-process
 * signer whose tokens the proxy routes verify. It is always instantiated (Nest
 * builds every provider), but only reachable when `BLOB_DRIVER=fs` selects it as
 * the active {@link import('../blob-store-provider').BlobStoreProvider}; in S3 mode
 * {@link active} is never called and `BLOB_FS_ROOT` may be unset.
 */
@Injectable()
export class FsBlobStoreProvider {
  readonly capabilities: BlobStoreCapabilities = FS_BLOB_STORE_CAPABILITIES;

  private readonly signer = new BlobProxySigner();

  /** A {@link FsBlobStore} over the configured root. Throws if `BLOB_FS_ROOT` is unset. */
  active(): BlobStore {
    return new FsBlobStore({
      root: this.requireRoot(),
      signer: this.signer,
      appOrigin: env().APP_ORIGIN,
      uploadTtlSeconds: env().SIGNED_UPLOAD_TTL_SECONDS,
      readTtlSeconds: env().SIGNED_READ_TTL_SECONDS,
    });
  }

  /** Verifies a proxied-upload token minted by {@link active}. Throws on tamper/expiry. */
  verifyUpload(token: string): UploadGrant {
    return this.signer.verifyUpload(token);
  }

  /** Verifies a proxied-download token minted by {@link active}. Throws on tamper/expiry. */
  verifyDownload(token: string): DownloadGrant {
    return this.signer.verifyDownload(token);
  }

  private requireRoot(): string {
    const root = env().BLOB_FS_ROOT;
    if (!root) throw new Error('BLOB_FS_ROOT must be configured when BLOB_DRIVER=fs');
    return root;
  }
}
