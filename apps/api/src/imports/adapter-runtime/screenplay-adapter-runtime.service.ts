import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SCREENPLAY_ADAPTER_PROTOCOL_VERSION } from '@coda/contracts';
import type {
  ScreenplayAdapterFailureReason,
  ScreenplayAdapterProgress,
  ScreenplayConversionReport,
  ScreenplaySourceFormat,
} from '@coda/contracts';
import { env } from '../../config/env';
import { ScreenplayAdapterAdmission } from './screenplay-adapter-admission';
import {
  buildScreenplayConversionReport,
  resolveScreenplayAdapterLimits,
} from './screenplay-adapter-limits';
import {
  GATED_SCREENPLAY_SOURCE_FORMATS,
  registeredScreenplaySourceFormats,
} from './screenplay-adapter-registry';
import {
  runScreenplayAdapterWorker,
  type ScreenplayAdapterWorkerFactory,
} from './screenplay-adapter-worker-host';

export interface ScreenplayAdapterConversionRequest {
  sourceFormat: ScreenplaySourceFormat;
  originalFilename: string;
  bytes: Uint8Array;
  /** Aborting terminates the adapter thread and yields a `cancelled` outcome. */
  signal?: AbortSignal;
  onProgress?: (progress: ScreenplayAdapterProgress) => void;
}

export type ScreenplayAdapterConversion =
  | { ok: true; convertedFountain: string; report: ScreenplayConversionReport }
  | { ok: false; reason: ScreenplayAdapterFailureReason; message: string };

/**
 * The bounded execution boundary every screenplay format adapter runs inside.
 *
 * Bounds, all enforced per conversion and all operator-configurable:
 *
 * - **Time** — `SCREENPLAY_ADAPTER_TIMEOUT_MS`, cooperatively inside the thread and
 *   then by hard termination after a fixed grace period.
 * - **Memory** — `SCREENPLAY_ADAPTER_MAX_OLD_GENERATION_MB` as a V8 heap ceiling on
 *   the thread's own isolate. Exceeding it destroys the thread, not the API process.
 * - **Input** — `SCREENPLAY_ADAPTER_MAX_INPUT_BYTES`, checked before a thread is spawned.
 * - **Output** — `SCREENPLAY_ADAPTER_MAX_OUTPUT_CHARACTERS` and
 *   `SCREENPLAY_ADAPTER_MAX_ELEMENTS` / `_MAX_WARNINGS`, checked inside the thread so an
 *   oversized payload never crosses back.
 * - **Concurrency** — `SCREENPLAY_ADAPTER_MAX_CONCURRENT`, refused rather than queued.
 *
 * Every outcome is a value. This service never throws for a conversion failure, so
 * a caller must map {@link ScreenplayAdapterConversion.reason} onto its own
 * transport semantics and can never mistake a hostile document for a bug.
 */
@Injectable()
export class ScreenplayAdapterRuntime {
  constructor(private readonly admission: ScreenplayAdapterAdmission) {}

  /** Formats this instance will dispatch, after configuration gating. */
  supportedSourceFormats(): ScreenplaySourceFormat[] {
    return registeredScreenplaySourceFormats().filter((format) => this.isAdmissible(format));
  }

  isAdmissible(sourceFormat: string): boolean {
    if (!registeredScreenplaySourceFormats().includes(sourceFormat)) return false;
    if (!GATED_SCREENPLAY_SOURCE_FORMATS.includes(sourceFormat)) return true;
    return env().SCREENPLAY_ADAPTER_TEST_FORMAT;
  }

  /** The input ceiling, so a caller can refuse an oversized upload without a thread. */
  maxInputBytes(): number {
    return env().SCREENPLAY_ADAPTER_MAX_INPUT_BYTES;
  }

  /**
   * Converts one document. `createWorker` exists only so the termination and
   * resource-limit behaviour can be proven against a real thread in tests; every
   * production caller omits it.
   */
  async convert(
    request: ScreenplayAdapterConversionRequest,
    createWorker?: ScreenplayAdapterWorkerFactory,
  ): Promise<ScreenplayAdapterConversion> {
    if (!this.isAdmissible(request.sourceFormat)) {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: `No screenplay adapter for ${request.sourceFormat}`,
      };
    }
    const limits = resolveScreenplayAdapterLimits();
    if (request.bytes.byteLength > limits.maxInputBytes) {
      return {
        ok: false,
        reason: 'input-too-large',
        message: `Original exceeds the ${limits.maxInputBytes}-byte conversion ceiling`,
      };
    }
    const admitted = await this.admission.run(async () => {
      const outcome = await runScreenplayAdapterWorker({
        request: {
          protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
          requestId: randomUUID(),
          sourceFormat: request.sourceFormat,
          originalFilename: request.originalFilename,
          limits,
        },
        bytes: request.bytes,
        maxOldGenerationSizeMb: env().SCREENPLAY_ADAPTER_MAX_OLD_GENERATION_MB,
        signal: request.signal,
        onProgress: request.onProgress,
        createWorker,
      });
      if (!outcome.ok) return outcome;
      return {
        ok: true as const,
        convertedFountain: outcome.convertedFountain,
        report: buildScreenplayConversionReport({
          sourceFormat: request.sourceFormat,
          adapter: outcome.adapter,
          output: {
            convertedFountain: outcome.convertedFountain,
            elements: outcome.elements,
            warnings: outcome.warnings,
          },
          generatedAt: new Date(),
        }),
      };
    });
    if (!admitted.admitted) {
      return { ok: false, reason: 'capacity', message: 'Screenplay conversion capacity is full' };
    }
    return admitted.value;
  }
}
