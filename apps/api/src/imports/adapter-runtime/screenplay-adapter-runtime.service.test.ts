import { describe, expect, it, vi } from 'vitest';
import { SCREENPLAY_ADAPTER_PROTOCOL_VERSION } from '@coda/contracts';
import { ScreenplayAdapterAdmission } from './screenplay-adapter-admission';
import { ScreenplayAdapterRuntime } from './screenplay-adapter-runtime.service';
import type { ScreenplayAdapterWorkerFactory } from './screenplay-adapter-worker-host';
import { RUNTIME_TEST_SOURCE_FORMAT } from './adapters/runtime-test.adapter';

const config = vi.hoisted(() => ({
  SCREENPLAY_ADAPTER_TIMEOUT_MS: 5_000,
  SCREENPLAY_ADAPTER_MAX_INPUT_BYTES: 64,
  SCREENPLAY_ADAPTER_MAX_OUTPUT_CHARACTERS: 2_048,
  SCREENPLAY_ADAPTER_MAX_ELEMENTS: 16,
  SCREENPLAY_ADAPTER_MAX_WARNINGS: 4,
  SCREENPLAY_ADAPTER_MAX_OLD_GENERATION_MB: 96,
  SCREENPLAY_ADAPTER_MAX_CONCURRENT: 1,
  SCREENPLAY_ADAPTER_TEST_FORMAT: true,
}));

vi.mock('../../config/env', () => ({ env: () => config }));

/** A stub thread that replies with whatever `reply` builds from the request. */
function stubWorker(reply: (requestId: string) => unknown): ScreenplayAdapterWorkerFactory {
  return (options) => {
    const { requestId } = options.workerData.request;
    return {
      onMessage: (listener) => setTimeout(() => listener(reply(requestId)), 0),
      onError: () => undefined,
      onExit: () => undefined,
      terminate: () => Promise.resolve(0),
    };
  };
}

function result(requestId: string) {
  return {
    protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
    requestId,
    type: 'result',
    adapter: { id: 'coda.spec', version: '1' },
    convertedFountain: '!Line',
    elements: [
      {
        id: 'a',
        status: 'converted',
        source: { kind: 'line', location: { unit: 'line', start: 0, end: 1 } },
        target: null,
        summary: 'Element a',
        warnings: [],
      },
    ],
    warnings: [],
  };
}

function runtime() {
  return new ScreenplayAdapterRuntime(new ScreenplayAdapterAdmission());
}

const bytes = new Uint8Array([1, 2, 3]);

describe('ScreenplayAdapterRuntime', () => {
  it('assembles the durable report from adapter output', async () => {
    const outcome = await runtime().convert(
      { sourceFormat: RUNTIME_TEST_SOURCE_FORMAT, originalFilename: 'a.demo', bytes },
      stubWorker(result),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.report).toMatchObject({
      schemaVersion: 1,
      sourceFormat: RUNTIME_TEST_SOURCE_FORMAT,
      adapter: { id: 'coda.spec', version: '1' },
      summary: { total: 1, converted: 1, preserved: 0, uncertain: 0, unsupported: 0 },
    });
  });

  it('refuses a format with no adapter before spawning anything', async () => {
    const outcome = await runtime().convert(
      { sourceFormat: 'rtf', originalFilename: 'a.rtf', bytes },
      () => {
        throw new Error('a thread must not be spawned');
      },
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'unsupported-format' });
  });

  it('refuses a gated format when configuration has not enabled it', async () => {
    config.SCREENPLAY_ADAPTER_TEST_FORMAT = false;
    try {
      const target = runtime();
      expect(target.isAdmissible(RUNTIME_TEST_SOURCE_FORMAT)).toBe(false);
      expect(target.supportedSourceFormats()).toEqual([]);
      await expect(
        target.convert(
          { sourceFormat: RUNTIME_TEST_SOURCE_FORMAT, originalFilename: 'a.demo', bytes },
          () => {
            throw new Error('a thread must not be spawned');
          },
        ),
      ).resolves.toMatchObject({ ok: false, reason: 'unsupported-format' });
    } finally {
      config.SCREENPLAY_ADAPTER_TEST_FORMAT = true;
    }
  });

  it('refuses an original above the input ceiling without spawning a thread', async () => {
    const outcome = await runtime().convert(
      {
        sourceFormat: RUNTIME_TEST_SOURCE_FORMAT,
        originalFilename: 'a.demo',
        bytes: new Uint8Array(config.SCREENPLAY_ADAPTER_MAX_INPUT_BYTES + 1),
      },
      () => {
        throw new Error('a thread must not be spawned');
      },
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'input-too-large' });
  });

  it('reports capacity rather than queueing beyond the concurrency ceiling', async () => {
    const target = runtime();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = target.convert(
      { sourceFormat: RUNTIME_TEST_SOURCE_FORMAT, originalFilename: 'a.demo', bytes },
      (options) => ({
        onMessage: (listener) => {
          void gate.then(() => listener(result(options.workerData.request.requestId)));
        },
        onError: () => undefined,
        onExit: () => undefined,
        terminate: () => Promise.resolve(0),
      }),
    );
    await expect(
      target.convert(
        { sourceFormat: RUNTIME_TEST_SOURCE_FORMAT, originalFilename: 'b.demo', bytes },
        () => {
          throw new Error('a thread must not be spawned when saturated');
        },
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'capacity' });
    release();
    await expect(holding).resolves.toMatchObject({ ok: true });
  }, 20_000);

  it('surfaces a worker failure reason unchanged', async () => {
    const outcome = await runtime().convert(
      { sourceFormat: RUNTIME_TEST_SOURCE_FORMAT, originalFilename: 'a.demo', bytes },
      stubWorker((requestId) => ({
        protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
        requestId,
        type: 'failure',
        reason: 'output-too-large',
        message: 'too much Fountain',
      })),
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'output-too-large' });
  });

  it('exposes the input ceiling so a caller can refuse an upload without a thread', () => {
    expect(runtime().maxInputBytes()).toBe(64);
  });
});
