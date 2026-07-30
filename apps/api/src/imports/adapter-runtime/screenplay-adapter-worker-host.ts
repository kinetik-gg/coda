import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
  SCREENPLAY_ADAPTER_STACK_MB,
  SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS,
  SCREENPLAY_ADAPTER_YOUNG_GENERATION_MB,
  screenplayAdapterWorkerMessageSchema,
} from '@coda/contracts';
import type {
  ScreenplayAdapterFailureReason,
  ScreenplayAdapterProgress,
  ScreenplayAdapterWorkerMessage,
  ScreenplayAdapterWorkerRequest,
} from '@coda/contracts';

/** The slice of a worker thread the host uses. Narrow so tests can supply a real one. */
export interface ScreenplayAdapterWorkerPort {
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: Error) => void): void;
  onExit(listener: (code: number) => void): void;
  /** Resolves once the thread is actually gone. */
  terminate(): Promise<unknown>;
}

export interface ScreenplayAdapterResourceLimits {
  maxOldGenerationSizeMb: number;
  maxYoungGenerationSizeMb: number;
  stackSizeMb: number;
}

export interface ScreenplayAdapterSpawnOptions {
  workerData: { request: ScreenplayAdapterWorkerRequest; bytes: ArrayBuffer };
  transferList: ArrayBuffer[];
  resourceLimits: ScreenplayAdapterResourceLimits;
}

export type ScreenplayAdapterWorkerFactory = (
  options: ScreenplayAdapterSpawnOptions,
) => ScreenplayAdapterWorkerPort;

/** What one bounded conversion produced. Never a thrown error: always an outcome. */
export type ScreenplayAdapterWorkerOutcome =
  | {
      ok: true;
      adapter: { id: string; version: string };
      convertedFountain: string;
      elements: ScreenplayAdapterWorkerSuccess['elements'];
      warnings: ScreenplayAdapterWorkerSuccess['warnings'];
    }
  | { ok: false; reason: ScreenplayAdapterFailureReason; message: string };

type ScreenplayAdapterWorkerSuccess = Extract<ScreenplayAdapterWorkerMessage, { type: 'result' }>;

export function wrapAdapterWorker(worker: Worker): ScreenplayAdapterWorkerPort {
  return {
    onMessage: (listener) => void worker.on('message', listener),
    onError: (listener) => void worker.once('error', listener),
    onExit: (listener) => void worker.once('exit', listener),
    terminate: () => worker.terminate(),
  };
}

/**
 * Spawns the compiled adapter thread. `.js` beside this module, because the API is
 * built with plain `tsc` and both dev and production run from `dist`, exactly as
 * the PDF page-count worker does.
 */
export const createNodeAdapterWorker: ScreenplayAdapterWorkerFactory = (options) =>
  wrapAdapterWorker(
    new Worker(join(__dirname, 'screenplay-adapter.worker.js'), {
      workerData: options.workerData,
      transferList: options.transferList,
      resourceLimits: options.resourceLimits,
    }),
  );

export function adapterResourceLimits(
  maxOldGenerationSizeMb: number,
): ScreenplayAdapterResourceLimits {
  return {
    maxOldGenerationSizeMb,
    maxYoungGenerationSizeMb: SCREENPLAY_ADAPTER_YOUNG_GENERATION_MB,
    stackSizeMb: SCREENPLAY_ADAPTER_STACK_MB,
  };
}

/**
 * A `Uint8Array` may be a view over Node's shared Buffer pool. Transferring that
 * ArrayBuffer would detach unrelated buffers, so copy unless the view owns its
 * whole backing store — the same guard the PDF worker path documents.
 */
function toTransferable(bytes: Uint8Array): ArrayBuffer {
  const ownsBuffer =
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer;
  return ownsBuffer ? bytes.buffer : new Uint8Array(bytes).buffer;
}

function outOfMemory(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY';
}

export interface ScreenplayAdapterWorkerRun {
  request: ScreenplayAdapterWorkerRequest;
  bytes: Uint8Array;
  maxOldGenerationSizeMb: number;
  /** Aborting terminates the thread and yields a `cancelled` outcome. */
  signal?: AbortSignal;
  onProgress?: (progress: ScreenplayAdapterProgress) => void;
  createWorker?: ScreenplayAdapterWorkerFactory;
}

interface Settlement {
  settle: (outcome: ScreenplayAdapterWorkerOutcome) => void;
  fail: (reason: ScreenplayAdapterFailureReason, message: string) => void;
}

function acceptMessage(
  raw: unknown,
  run: ScreenplayAdapterWorkerRun,
  settlement: Settlement,
): void {
  const parsed = screenplayAdapterWorkerMessageSchema.safeParse(raw);
  if (!parsed.success) {
    settlement.fail('protocol-error', 'Adapter worker sent an unreadable message');
    return;
  }
  const message = parsed.data;
  if (
    message.protocolVersion !== SCREENPLAY_ADAPTER_PROTOCOL_VERSION ||
    message.requestId !== run.request.requestId
  ) {
    settlement.fail('protocol-error', 'Adapter worker replied to a different request');
    return;
  }
  if (message.type === 'progress') {
    run.onProgress?.(message.progress);
    return;
  }
  if (message.type === 'failure') {
    settlement.fail(message.reason, message.message);
    return;
  }
  settlement.settle({
    ok: true,
    adapter: message.adapter,
    convertedFountain: message.convertedFountain,
    elements: message.elements,
    warnings: message.warnings,
  });
}

/**
 * Runs one conversion in a throwaway thread and resolves with its outcome.
 *
 * The time bound is two-tiered. The worker holds a soft deadline at
 * `limits.timeoutMs` so a cooperative adapter can stop and report `timeout`
 * itself; the host holds a hard deadline at `limits.timeoutMs` plus
 * {@link SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS} and terminates the thread. The
 * hard tier is the actual guarantee, because an adapter spinning in synchronous
 * code never returns to its event loop to observe the soft one.
 *
 * Termination is always awaited before the outcome resolves. A caller therefore
 * cannot observe a completed conversion while its thread is still alive, which is
 * what makes the admission slot count equal to the live thread count.
 */
export function runScreenplayAdapterWorker(
  run: ScreenplayAdapterWorkerRun,
): Promise<ScreenplayAdapterWorkerOutcome> {
  const createWorker = run.createWorker ?? createNodeAdapterWorker;
  const bytes = toTransferable(run.bytes);
  return new Promise<ScreenplayAdapterWorkerOutcome>((resolve) => {
    let done = false;
    let worker: ScreenplayAdapterWorkerPort | undefined;
    // Held indirectly so `finish` can clear a timer that is created after it.
    const timers: { hardDeadline?: NodeJS.Timeout } = {};
    const onAbort = (): void => settlement.fail('cancelled', 'Conversion was cancelled');
    const finish = (outcome: ScreenplayAdapterWorkerOutcome): void => {
      if (done) return;
      done = true;
      if (timers.hardDeadline) clearTimeout(timers.hardDeadline);
      run.signal?.removeEventListener('abort', onAbort);
      const port = worker;
      if (!port) {
        resolve(outcome);
        return;
      }
      void Promise.resolve(port.terminate())
        .catch(() => undefined)
        .then(() => resolve(outcome));
    };
    const settlement: Settlement = {
      settle: finish,
      fail: (reason, message) => finish({ ok: false, reason, message }),
    };
    if (run.signal?.aborted) {
      settlement.fail('cancelled', 'Conversion was cancelled');
      return;
    }
    timers.hardDeadline = setTimeout(
      () => settlement.fail('timeout', 'Conversion exceeded its time budget'),
      run.request.limits.timeoutMs + SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS,
    );
    run.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      worker = createWorker({
        workerData: { request: run.request, bytes },
        transferList: [bytes],
        resourceLimits: adapterResourceLimits(run.maxOldGenerationSizeMb),
      });
    } catch {
      settlement.fail('internal', 'Adapter worker could not be started');
      return;
    }
    worker.onMessage((message) => acceptMessage(message, run, settlement));
    worker.onError((error) =>
      outOfMemory(error)
        ? settlement.fail('memory', 'Conversion exceeded its memory budget')
        : settlement.fail('internal', 'Adapter worker failed'),
    );
    worker.onExit(() =>
      settlement.fail('protocol-error', 'Adapter worker exited without a result'),
    );
  });
}
