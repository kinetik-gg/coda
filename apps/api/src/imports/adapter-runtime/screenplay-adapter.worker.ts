import { parentPort, workerData } from 'node:worker_threads';
import {
  SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
  screenplayAdapterWorkerRequestSchema,
} from '@coda/contracts';
import { executeScreenplayAdapterRequest } from './screenplay-adapter-execution';

interface WorkerPayload {
  request: unknown;
  bytes: ArrayBuffer;
}

/**
 * The adapter thread. Kept to dispatch only — every decision worth testing lives
 * in `screenplay-adapter-execution.ts`, which runs in-process under Vitest, while
 * the host's termination behaviour is tested against a real thread.
 *
 * Failures are always converted into a message rather than thrown: the host reads
 * an unexpected `'error'` event or a message-less exit as `protocol-error`, so a
 * thrown value here would lose the reason.
 */
async function main(): Promise<void> {
  const port = parentPort;
  if (!port) return;
  const payload = workerData as WorkerPayload;
  const request = screenplayAdapterWorkerRequestSchema.parse(payload.request);
  await executeScreenplayAdapterRequest({
    request,
    bytes: new Uint8Array(payload.bytes),
    emit: (message) => port.postMessage(message),
  });
}

void main().catch((error: unknown) => {
  parentPort?.postMessage({
    protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
    requestId: 'unknown',
    type: 'failure',
    reason: 'protocol-error',
    message: error instanceof Error ? error.message.slice(0, 1_000) : 'Adapter worker failed',
  });
});
