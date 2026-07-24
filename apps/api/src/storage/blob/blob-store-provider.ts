import type { BlobStoreCapabilities } from '@coda/contracts';
import type { BlobStore } from './blob-store';

/**
 * The driver-selection seam the transfer path resolves through. Both the S3 and
 * the filesystem providers satisfy it; the active one is chosen from
 * `BLOB_DRIVER` at boot. Consumers (only {@link import('../storage.service').StorageService})
 * negotiate {@link capabilities} and call {@link active} per operation rather than
 * caching, so a driver never leaks its concrete type past this abstraction.
 *
 * Used as a Nest injection token: a `useFactory` binds it to the S3 or FS
 * provider. The storage wizard, migration job, and backup engine keep injecting
 * the concrete `S3BlobStoreProvider` — they remain S3-only for now.
 */
export abstract class BlobStoreProvider {
  abstract readonly capabilities: BlobStoreCapabilities;

  /** A {@link BlobStore} over the active backend. Call once per operation, never cache. */
  abstract active(): BlobStore;
}
