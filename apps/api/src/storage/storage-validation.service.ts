import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type {
  StorageConnectionInput,
  StorageProbeCheck,
  StorageProbeCheckName,
  StorageProbeResult,
} from '@coda/contracts';
import { env } from '../config/env';

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
 * Runs a bounded, residue-free validation probe against a candidate object-storage
 * backend before it is ever persisted or activated. Each capability is reported
 * independently — write, read, delete, presigned-URL generation, and a CORS
 * preflight against APP_ORIGIN — so the operator sees exactly which check failed.
 * The probe object is always deleted, even on partial failure.
 */
@Injectable()
export class StorageValidationService {
  private readonly logger = new Logger(StorageValidationService.name);

  async probe(connection: StorageConnectionInput): Promise<StorageProbeResult> {
    const deadline = AbortSignal.timeout(PROBE_DEADLINE_MS);
    const internal = this.buildClient(connection, connection.endpoint);
    const publicClient = this.buildClient(connection, connection.publicEndpoint);
    const key = `.coda-probe/${randomUUID()}`;
    const checks: StorageProbeCheck[] = [];
    let written = false;

    try {
      written = await this.runWrite(internal, connection.bucket, key, checks, deadline);
      if (written) {
        await this.runRead(internal, connection.bucket, key, checks, deadline);
      }
      await this.runPresign(publicClient, connection, key, checks);
      await this.runCors(connection, key, checks, deadline);
    } finally {
      if (written) await this.cleanup(internal, connection.bucket, key, checks, deadline);
      internal.destroy();
      publicClient.destroy();
    }

    return { ok: checks.every((check) => check.ok), checks };
  }

  private buildClient(connection: StorageConnectionInput, endpoint: string): S3Client {
    return new S3Client({
      region: connection.region,
      forcePathStyle: connection.forcePathStyle,
      endpoint,
      credentials: {
        accessKeyId: connection.accessKeyId,
        secretAccessKey: connection.secretAccessKey,
      },
    });
  }

  private async runWrite(
    client: S3Client,
    bucket: string,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<boolean> {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: PROBE_PAYLOAD,
          ContentType: 'application/octet-stream',
        }),
        { abortSignal: this.step(deadline) },
      );
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
    client: S3Client,
    bucket: string,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: this.step(deadline),
      });
      const bytes = response.Body
        ? Buffer.from(await response.Body.transformToByteArray())
        : Buffer.alloc(0);
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

  private async runPresign(
    client: S3Client,
    connection: StorageConnectionInput,
    key: string,
    checks: StorageProbeCheck[],
  ): Promise<void> {
    try {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: connection.bucket, Key: key }),
        { expiresIn: 60 },
      );
      const parsed = new URL(url);
      const publicOrigin = new URL(connection.publicEndpoint).origin;
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
      this.fail(checks, 'presign', `Could not generate a signed URL: ${message(error)}.`);
    }
  }

  private async runCors(
    connection: StorageConnectionInput,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    const appOrigin = env().APP_ORIGIN;
    const target = this.objectUrl(connection, key);
    try {
      const response = await fetch(target, {
        method: 'OPTIONS',
        headers: {
          Origin: appOrigin,
          'Access-Control-Request-Method': 'GET',
        },
        signal: this.step(deadline),
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
      this.fail(checks, 'cors', `Could not verify CORS against ${appOrigin}: ${message(error)}.`);
    }
  }

  private async cleanup(
    client: S3Client,
    bucket: string,
    key: string,
    checks: StorageProbeCheck[],
    deadline: AbortSignal,
  ): Promise<void> {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: this.step(deadline),
      });
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

  private objectUrl(connection: StorageConnectionInput, key: string): string {
    const base = new URL(connection.endpoint);
    const path = connection.forcePathStyle
      ? `${base.pathname.replace(/\/$/u, '')}/${connection.bucket}/${key}`
      : `/${key}`;
    if (!connection.forcePathStyle) base.hostname = `${connection.bucket}.${base.hostname}`;
    base.pathname = path;
    return base.toString();
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
