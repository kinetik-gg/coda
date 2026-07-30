import {
  SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
  ScreenplayAdapterAbortError,
  ScreenplayAdapterSourceError,
} from '@coda/contracts';
import type {
  ScreenplayAdapter,
  ScreenplayAdapterContext,
  ScreenplayAdapterFailureReason,
  ScreenplayAdapterOutput,
  ScreenplayAdapterProgress,
  ScreenplayAdapterWorkerMessage,
  ScreenplayAdapterWorkerRequest,
} from '@coda/contracts';
import { loadScreenplayAdapter } from './screenplay-adapter-registry';

/** How the worker publishes messages. Injected so the core is testable in-process. */
export type ScreenplayAdapterEmit = (message: ScreenplayAdapterWorkerMessage) => void;

export interface ScreenplayAdapterExecutionOptions {
  request: ScreenplayAdapterWorkerRequest;
  bytes: Uint8Array;
  emit: ScreenplayAdapterEmit;
  /** Overridden in tests; production always resolves through the lazy registry. */
  resolve?: (sourceFormat: string) => Promise<ScreenplayAdapter | undefined>;
}

function failure(
  request: ScreenplayAdapterWorkerRequest,
  reason: ScreenplayAdapterFailureReason,
  message: string,
): ScreenplayAdapterWorkerMessage {
  return {
    protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
    requestId: request.requestId,
    type: 'failure',
    reason,
    message: message.slice(0, 1_000) || 'Screenplay conversion failed',
  };
}

/**
 * Classifies whatever an adapter threw. Only the two error types the contract
 * defines produce a specific reason and keep their message; anything else is an
 * adapter defect, reported as `invalid-source` with a fixed message so a stack
 * trace or internal path can never reach an API client.
 */
function classify(error: unknown): { reason: ScreenplayAdapterFailureReason; message: string } {
  if (error instanceof ScreenplayAdapterAbortError) {
    return { reason: 'timeout', message: 'Conversion exceeded its time budget' };
  }
  if (error instanceof ScreenplayAdapterSourceError) {
    return { reason: 'invalid-source', message: error.message };
  }
  return { reason: 'invalid-source', message: 'Document could not be converted' };
}

/**
 * Checks the output an adapter produced against the run's ceilings. Enforcing
 * here — inside the boundary, before the bytes cross back to the host — means a
 * runaway adapter cannot make the host allocate an oversized payload, and the
 * failure is still attributable to a specific limit.
 */
function checkOutput(
  output: ScreenplayAdapterOutput,
  request: ScreenplayAdapterWorkerRequest,
): { reason: ScreenplayAdapterFailureReason; message: string } | undefined {
  const { limits } = request;
  if (output.convertedFountain.length > limits.maxOutputCharacters) {
    return {
      reason: 'output-too-large',
      message: `Converted Fountain exceeds the ${limits.maxOutputCharacters}-character ceiling`,
    };
  }
  if (output.elements.length > limits.maxElements) {
    return {
      reason: 'element-limit',
      message: `Conversion report exceeds the ${limits.maxElements}-element ceiling`,
    };
  }
  if (output.warnings.length > limits.maxWarnings) {
    return {
      reason: 'element-limit',
      message: `Conversion report exceeds the ${limits.maxWarnings}-warning ceiling`,
    };
  }
  return undefined;
}

function createContext(
  request: ScreenplayAdapterWorkerRequest,
  emit: ScreenplayAdapterEmit,
  controller: AbortController,
): ScreenplayAdapterContext {
  const throwIfCancelled = (): void => {
    if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
  };
  return {
    signal: controller.signal,
    limits: request.limits,
    throwIfCancelled,
    reportProgress: (progress: ScreenplayAdapterProgress): void => {
      if (controller.signal.aborted) return;
      emit({
        protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
        requestId: request.requestId,
        type: 'progress',
        progress: {
          stage: progress.stage.slice(0, 80) || 'working',
          completed: Math.max(0, Math.trunc(progress.completed)),
          total: Math.max(0, Math.trunc(progress.total)),
        },
      });
    },
  };
}

/**
 * Runs one conversion to a single terminal message.
 *
 * The soft deadline started here is the *cooperative* half of the time bound: it
 * aborts the context so an adapter that awaits or polls can stop and be reported
 * as `timeout`. It is not a guarantee — an adapter spinning in synchronous code
 * never returns to the event loop and this timer never fires. The guarantee is
 * the host terminating the thread after the grace period, which is why this
 * function is only ever called from a thread the host owns and can destroy.
 */
export async function executeScreenplayAdapterRequest(
  options: ScreenplayAdapterExecutionOptions,
): Promise<void> {
  const { request, bytes, emit } = options;
  const resolve = options.resolve ?? loadScreenplayAdapter;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), request.limits.timeoutMs);
  try {
    if (bytes.byteLength > request.limits.maxInputBytes) {
      emit(
        failure(
          request,
          'input-too-large',
          `Original exceeds the ${request.limits.maxInputBytes}-byte ceiling`,
        ),
      );
      return;
    }
    const adapter = await resolve(request.sourceFormat);
    if (!adapter) {
      emit(failure(request, 'unsupported-format', `No adapter for ${request.sourceFormat}`));
      return;
    }
    const context = createContext(request, emit, controller);
    const output = await adapter.convert(
      { sourceFormat: request.sourceFormat, originalFilename: request.originalFilename, bytes },
      context,
    );
    const rejected = checkOutput(output, request);
    if (rejected) {
      emit(failure(request, rejected.reason, rejected.message));
      return;
    }
    if (controller.signal.aborted) {
      emit(failure(request, 'timeout', 'Conversion exceeded its time budget'));
      return;
    }
    emit({
      protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: 'result',
      adapter: { id: adapter.id, version: adapter.version },
      convertedFountain: output.convertedFountain,
      elements: output.elements,
      warnings: output.warnings,
    });
  } catch (error) {
    const { reason, message } = classify(error);
    emit(failure(request, reason, message));
  } finally {
    clearTimeout(deadline);
  }
}
