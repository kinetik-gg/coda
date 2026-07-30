import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { SCREENPLAY_ADAPTER_PROTOCOL_VERSION } from '@coda/contracts';
import type { ScreenplayAdapterWorkerRequest } from '@coda/contracts';
import {
  runScreenplayAdapterWorker,
  wrapAdapterWorker,
  type ScreenplayAdapterWorkerFactory,
} from './screenplay-adapter-worker-host';

/**
 * These cases run **real** worker threads with real `resourceLimits`, built from
 * inline source rather than the compiled worker, so the host's termination and
 * memory boundary are proven rather than mocked. A mocked `node:worker_threads`
 * can only ever assert that options were passed; the acceptance criterion for the
 * runtime is that a non-terminating document is actually killed.
 */
const evalWorkerFactory: ScreenplayAdapterWorkerFactory = (options) =>
  wrapAdapterWorker(
    new Worker((options.workerData.request as unknown as { code: string }).code, {
      eval: true,
      workerData: options.workerData,
      transferList: options.transferList,
      resourceLimits: options.resourceLimits,
    }),
  );

function request(code: string, timeoutMs = 1_000): ScreenplayAdapterWorkerRequest {
  const value = {
    protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
    requestId: 'request-1',
    sourceFormat: 'demo',
    originalFilename: 'pilot.demo',
    limits: {
      timeoutMs,
      maxInputBytes: 1_048_576,
      maxOutputCharacters: 1_000,
      maxElements: 10,
      maxWarnings: 10,
    },
  };
  return { ...value, code } as unknown as ScreenplayAdapterWorkerRequest;
}

/** Inline worker source that replies with one well-formed message. */
function replies(message: string): string {
  return `const { parentPort, workerData } = require('node:worker_threads');
    parentPort.postMessage(${message});`;
}

const envelope = `{ protocolVersion: ${SCREENPLAY_ADAPTER_PROTOCOL_VERSION}, requestId: workerData.request.requestId }`;

async function host(code: string, timeoutMs?: number, signal?: AbortSignal) {
  return runScreenplayAdapterWorker({
    request: request(code, timeoutMs),
    bytes: new Uint8Array([1, 2, 3, 4]),
    maxOldGenerationSizeMb: 64,
    signal,
    createWorker: evalWorkerFactory,
  });
}

describe('runScreenplayAdapterWorker (real threads)', () => {
  it('resolves a well-formed result and hands back the adapter identity', async () => {
    const outcome = await host(
      replies(
        `{ ...${envelope}, type: 'result', adapter: { id: 'coda.spec', version: '1' },
          convertedFountain: '!Line', elements: [], warnings: [] }`,
      ),
    );
    expect(outcome).toMatchObject({
      ok: true,
      adapter: { id: 'coda.spec', version: '1' },
      convertedFountain: '!Line',
    });
  }, 20_000);

  it('receives the transferred original bytes intact', async () => {
    const outcome = await host(
      replies(
        `{ ...${envelope}, type: 'result', adapter: { id: 'coda.spec', version: '1' },
          convertedFountain: Array.from(new Uint8Array(workerData.bytes)).join('-'),
          elements: [], warnings: [] }`,
      ),
    );
    expect(outcome).toMatchObject({ ok: true, convertedFountain: '1-2-3-4' });
  }, 20_000);

  it('forwards progress before the terminal message', async () => {
    const progress: number[] = [];
    const outcome = await runScreenplayAdapterWorker({
      request: request(
        `const { parentPort, workerData } = require('node:worker_threads');
         parentPort.postMessage({ ...${envelope}, type: 'progress', progress: { stage: 'pages', completed: 1, total: 2 } });
         parentPort.postMessage({ ...${envelope}, type: 'result', adapter: { id: 'coda.spec', version: '1' }, convertedFountain: '!x', elements: [], warnings: [] });`,
      ),
      bytes: new Uint8Array([1]),
      maxOldGenerationSizeMb: 64,
      onProgress: (value) => progress.push(value.completed),
      createWorker: evalWorkerFactory,
    });
    expect(progress).toEqual([1]);
    expect(outcome.ok).toBe(true);
  }, 20_000);

  it('forcibly terminates a non-terminating document inside the configured budget', async () => {
    const started = Date.now();
    const outcome = await host(`for (;;) {}`, 1_000);
    const elapsed = Date.now() - started;
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout' });
    // Hard deadline is timeoutMs + the 2s grace; anything close to that proves the
    // thread was killed rather than allowed to finish.
    expect(elapsed).toBeLessThan(15_000);
    expect(elapsed).toBeGreaterThanOrEqual(2_500);
  }, 30_000);

  it('destroys a thread that exceeds its heap ceiling instead of the API process', async () => {
    // On-heap JS arrays, deliberately: an `ArrayBuffer` backing store is external
    // memory and is *not* bounded by `maxOldGenerationSizeMb`, so a byte-buffer
    // fixture would prove nothing about this ceiling.
    const outcome = await host(
      `const held = [];
       for (;;) { held.push(new Array(200000).fill('x')); }`,
      120_000,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('memory');
  }, 60_000);

  it('terminates on caller cancellation', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const outcome = await host(`for (;;) {}`, 120_000, controller.signal);
    expect(outcome).toMatchObject({ ok: false, reason: 'cancelled' });
  }, 30_000);

  it('reports cancellation without spawning a thread when already aborted', async () => {
    const outcome = await runScreenplayAdapterWorker({
      request: request(`for (;;) {}`),
      bytes: new Uint8Array([1]),
      maxOldGenerationSizeMb: 64,
      signal: AbortSignal.abort(),
      createWorker: () => {
        throw new Error('a thread must not be spawned for an aborted run');
      },
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'cancelled' });
  }, 20_000);

  it('distrusts a reply addressed to a different request', async () => {
    const outcome = await host(
      replies(
        `{ protocolVersion: ${SCREENPLAY_ADAPTER_PROTOCOL_VERSION}, requestId: 'other',
          type: 'failure', reason: 'timeout', message: 'stale' }`,
      ),
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'protocol-error' });
  }, 20_000);

  it('distrusts an unreadable message', async () => {
    const outcome = await host(replies(`{ type: 'chunk' }`));
    expect(outcome).toMatchObject({ ok: false, reason: 'protocol-error' });
  }, 20_000);

  it('treats a thread that exits without a terminal message as a protocol error', async () => {
    const outcome = await host(`/* exits immediately */`);
    expect(outcome).toMatchObject({ ok: false, reason: 'protocol-error' });
  }, 20_000);

  it('surfaces a worker-reported failure with its reason preserved', async () => {
    const outcome = await host(
      replies(`{ ...${envelope}, type: 'failure', reason: 'invalid-source', message: 'bad zip' }`),
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid-source', message: 'bad zip' });
  }, 20_000);

  it('reports an internal failure when a thread cannot be started', async () => {
    const outcome = await runScreenplayAdapterWorker({
      request: request(`for (;;) {}`),
      bytes: new Uint8Array([1]),
      maxOldGenerationSizeMb: 64,
      createWorker: () => {
        throw new Error('spawn refused');
      },
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'internal' });
  }, 20_000);

  it('passes the configured heap ceiling and the fixed young-generation and stack floors', async () => {
    let seen: unknown;
    await runScreenplayAdapterWorker({
      request: request(`x`),
      bytes: new Uint8Array([1]),
      maxOldGenerationSizeMb: 128,
      createWorker: (options) => {
        seen = options.resourceLimits;
        return {
          onMessage: () => undefined,
          onError: () => undefined,
          onExit: (listener) => setTimeout(() => listener(0), 0),
          terminate: () => Promise.resolve(0),
        };
      },
    });
    expect(seen).toEqual({
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 32,
      stackSizeMb: 4,
    });
  }, 20_000);
});
