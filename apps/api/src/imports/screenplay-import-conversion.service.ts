import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ConvertScreenplayImportArtifact,
  ScreenplayAdapterFailureReason,
} from '@coda/contracts';
import type { ScreenplayImportArtifact } from '@prisma/client';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { BlobStoreProvider } from '../storage/blob/blob-store-provider';
import { collectStream } from '../storage/blob/collect-stream';
import { ScreenplayAdapterRuntime } from './adapter-runtime/screenplay-adapter-runtime.service';
import { ScreenplayImportArtifactsService } from './screenplay-import-artifacts.service';

/** Ceiling on fetching the original out of blob storage, separate from the adapter deadline. */
const READ_TIMEOUT_MS = 60_000;

/**
 * How the runtime's failure taxonomy reaches an API client. Kept as one table so
 * a new reason cannot be added without a deliberate decision about its status,
 * and so no branch of the conversion path invents its own status code.
 */
type FailureException = (message: string) => HttpException;

const FAILURE_EXCEPTIONS: Record<ScreenplayAdapterFailureReason, FailureException> = {
  'unsupported-format': (message) => new BadRequestException(message),
  'input-too-large': (message) => new PayloadTooLargeException(message),
  'output-too-large': (message) => new UnprocessableEntityException(message),
  'element-limit': (message) => new UnprocessableEntityException(message),
  'invalid-source': (message) => new BadRequestException(message),
  timeout: (message) => new HttpException(message, HttpStatus.GATEWAY_TIMEOUT),
  memory: (message) => new UnprocessableEntityException(message),
  cancelled: (message) => new HttpException(message, HttpStatus.REQUEST_TIMEOUT),
  capacity: (message) => new ServiceUnavailableException(message),
  // A runtime defect must never describe itself to a client.
  'protocol-error': () => new InternalServerErrorException('Screenplay conversion failed'),
  internal: () => new InternalServerErrorException('Screenplay conversion failed'),
};

/**
 * Converts an already-uploaded original on the server, inside the bounded adapter
 * runtime, and completes the artifact with the result.
 *
 * This is the alternative to a client supplying its own `convertedFountain`: the
 * bytes never leave the instance, the deadline and heap ceiling are enforced where
 * they can actually be enforced, and the report is assembled from adapter output
 * rather than trusted from a request body.
 *
 * A failed conversion always leaves the artifact `FAILED`, never `PENDING`. That
 * matters for reclamation: the stale-upload sweep queues both `PENDING` and
 * `FAILED` artifacts for blob deletion, so a hostile document that was terminated
 * cannot leave an original blob behind. No screenplay is created on any path here
 * — the artifact tables are the only thing this service writes.
 */
@Injectable()
export class ScreenplayImportConversionService {
  constructor(
    private readonly permissions: ScreenplayPermissionService,
    private readonly blobs: BlobStoreProvider,
    private readonly artifacts: ScreenplayImportArtifactsService,
    private readonly runtime: ScreenplayAdapterRuntime,
  ) {}

  async convert(
    userId: string,
    screenplayId: string,
    artifactId: string,
    input: ConvertScreenplayImportArtifact,
  ) {
    await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    const artifact = await this.artifacts.pendingForConversion(
      screenplayId,
      artifactId,
      input.version,
    );
    if (!this.runtime.isAdmissible(artifact.sourceFormat)) {
      await this.artifacts.failConversion(artifact);
      throw new BadRequestException(`No screenplay adapter for ${artifact.sourceFormat}`);
    }
    if (artifact.sizeBytes > BigInt(this.runtime.maxInputBytes())) {
      await this.artifacts.failConversion(artifact);
      throw new PayloadTooLargeException(
        `Original exceeds the ${this.runtime.maxInputBytes()}-byte conversion ceiling`,
      );
    }
    const bytes = await this.readOriginal(artifact);
    const outcome = await this.runtime.convert({
      sourceFormat: artifact.sourceFormat,
      originalFilename: artifact.originalFilename,
      bytes,
    });
    if (!outcome.ok) {
      await this.artifacts.failConversion(artifact);
      throw FAILURE_EXCEPTIONS[outcome.reason](outcome.message);
    }
    return this.artifacts.complete(userId, screenplayId, artifactId, {
      version: input.version,
      convertedFountain: outcome.convertedFountain,
      report: outcome.report,
    });
  }

  /**
   * Reads the reserved original. Bounded by its own abort deadline so an
   * unresponsive blob backend cannot hold the request open indefinitely, and
   * length-checked against the reservation so the adapter never sees bytes the
   * caller did not declare.
   */
  private async readOriginal(artifact: ScreenplayImportArtifact): Promise<Uint8Array> {
    const declared = Number(artifact.sizeBytes);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), READ_TIMEOUT_MS);
    try {
      const { stream } = await this.blobs
        .active()
        .get(artifact.objectKey, { abortSignal: abort.signal });
      const bytes = await collectStream(stream);
      if (bytes.byteLength !== declared) throw new Error('Original size changed after upload');
      return bytes;
    } catch {
      await this.artifacts.failConversion(artifact);
      throw new BadRequestException('Reserved original upload could not be read');
    } finally {
      clearTimeout(timeout);
    }
  }
}
