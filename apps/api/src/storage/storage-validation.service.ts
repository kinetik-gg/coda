import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type {
  StorageConnectionInput,
  StorageProbeCheck,
  StorageProbeCheckName,
  StorageProbeResult,
} from '@coda/contracts';
import type { BlobStore } from './blob/blob-store';
import { collectStream } from './blob/collect-stream';
import { S3BlobStoreProvider } from './blob/s3/s3-blob-store.provider';

/** Overall wall-clock ceiling for a full probe run, so validation never hangs. */
const PROBE_DEADLINE_MS = 15_000;
/** Per-network-operation timeout inside the overall deadline. */
const PROBE_STEP_TIMEOUT_MS = 6_000;
/** Bytes written and read back to prove round-trip integrity. */
const PROBE_PAYLOAD = Buffer.from('coda-storage-probe');

function message(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 480);
  return String(error).slice(0, 480);
}

/**
 * Runs a bounded, residue-free validation probe against a candidate backend
 * before it is ever persisted or activated. Each capability is reported
 * independently — write, read, delete, and (for direct-upload backends)
 * presigned-URL generation and a CORS preflight — so the operator sees exactly
 * which check failed. The probe object is always deleted, even on partial
 * failure. Every S3/presign specific lives in the driver behind {@link BlobStore};
 * this service only orchestrates the capability contract.
 */
@Injectable()
export class StorageValidationService {
  private readonly logger = new Logger(StorageValidationService.name);

  constructor(private readonly blobs: S3BlobStoreProvider) {}

  async probe(connection: StorageConnectionInput): Promise<StorageProbeResult> {
    const deadline = AbortSignal.timeout(PROBE_DEADLINE_MS);
    const store = this.blobs.forConnection(connection);
    const key = `.coda-probe/${randomUUID()}`;
    const checks: StorageProbeCheck[] = [];
    let written = false;

    try {
      written = await this.runWrite(store, key, checks, deadline);
      if (written) {
        await this.runRead(store, key, checks, deadline);
      }
      if (store.probeDirectAccess) {
        checks.push(...(await store.probeDirectAccess(key, deadline)));
      }
    } finally {
      if (written) await this.cleanup(store, connection.bucket, key, checks, deadline);
      store.dispose();
    }

    return { ok: checks.every((check) => check.ok), checks };
  }

  private async runWrite(
    store: BlobStore,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<boolean> {
    try {
      await store.put(key, Readable.from(PROBE_PAYLOAD), {
        contentType: 'application/octet-stream',
        // The length is known, so the driver can bound the write; without it a
        // streaming Body signs as aws-chunked with an undefined decoded length,
        // which S3/MinIO reject.
        contentLength: PROBE_PAYLOAD.byteLength,
        abortSignal: this.step(deadline),
      });
      this.pass(checks, 'write', 'Wrote a probe object to the bucket.');
      return true;
    } catch (error) {
      this.fail(
        checks,
        'write',
        `Could not write to the bucket: ${message(error)}. Check the bucket name, credentials, and write permissions.`,
      );
      return false;
    }
  }

  private async runRead(
    store: BlobStore,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    try {
      const { stream } = await store.get(key, { abortSignal: this.step(deadline) });
      const bytes = await collectStream(stream);
      if (!bytes.equals(PROBE_PAYLOAD)) {
        this.fail(checks, 'read', 'Read the probe object but its contents did not match.');
        return;
      }
      this.pass(checks, 'read', 'Read the probe object back and verified its contents.');
    } catch (error) {
      this.fail(
        checks,
        'read',
        `Could not read from the bucket: ${message(error)}. Check read permissions.`,
      );
    }
  }

  private async cleanup(
    store: BlobStore,
    bucket: string,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    try {
      await store.delete(key, { abortSignal: this.step(deadline) });
      this.pass(checks, 'delete', 'Deleted the probe object, leaving no residue.');
    } catch (error) {
      this.fail(
        checks,
        'delete',
        `Left a probe object behind: ${message(error)}. Check delete permissions.`,
      );
      this.logger.warn(`Storage probe could not delete ${key} from ${bucket}`);
    }
  }

  private step(deadline: AbortSignal): AbortSignal {
    return AbortSignal.any([deadline, AbortSignal.timeout(PROBE_STEP_TIMEOUT_MS)]);
  }

  private pass(checks: StorageProbeCheck[], name: StorageProbeCheckName, detail: string): void {
    checks.push({ name, ok: true, detail });
  }

  private fail(checks: StorageProbeCheck[], name: StorageProbeCheckName, detail: string): void {
    checks.push({ name, ok: false, detail });
  }
}
