import { describe, expect, it, vi } from 'vitest';
import { SCREENPLAY_ADAPTER_PROTOCOL_VERSION, ScreenplayAdapterSourceError } from '@coda/contracts';
import type {
  ScreenplayAdapter,
  ScreenplayAdapterContext,
  ScreenplayAdapterOutput,
  ScreenplayAdapterWorkerMessage,
  ScreenplayAdapterWorkerRequest,
  ScreenplayConversionElement,
} from '@coda/contracts';
import { executeScreenplayAdapterRequest } from './screenplay-adapter-execution';

const limits = {
  timeoutMs: 1_000,
  maxInputBytes: 64,
  maxOutputCharacters: 32,
  maxElements: 2,
  maxWarnings: 1,
};

function request(
  overrides: Partial<ScreenplayAdapterWorkerRequest> = {},
): ScreenplayAdapterWorkerRequest {
  return {
    protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
    requestId: 'request-1',
    sourceFormat: 'demo',
    originalFilename: 'pilot.demo',
    limits,
    ...overrides,
  };
}

function element(id: string): ScreenplayConversionElement {
  return {
    id,
    status: 'converted',
    source: { kind: 'line', location: { unit: 'line', start: 0, end: 1 } },
    target: null,
    summary: `Element ${id}`,
    warnings: [],
  };
}

function adapter(
  convert: (input: unknown, context: ScreenplayAdapterContext) => Promise<ScreenplayAdapterOutput>,
): ScreenplayAdapter {
  return {
    id: 'coda.spec',
    version: '1',
    sourceFormats: ['demo'],
    convert: convert as ScreenplayAdapter['convert'],
  };
}

async function run(options: {
  bytes?: Uint8Array;
  request?: ScreenplayAdapterWorkerRequest;
  adapter?: ScreenplayAdapter;
}): Promise<ScreenplayAdapterWorkerMessage[]> {
  const emitted: ScreenplayAdapterWorkerMessage[] = [];
  await executeScreenplayAdapterRequest({
    request: options.request ?? request(),
    bytes: options.bytes ?? new Uint8Array([1, 2, 3]),
    emit: (message) => emitted.push(message),
    resolve: () => Promise.resolve(options.adapter),
  });
  return emitted;
}

function terminal(messages: ScreenplayAdapterWorkerMessage[]) {
  const last = messages.at(-1);
  if (!last || last.type === 'progress') throw new Error('No terminal message was emitted');
  return last;
}

describe('executeScreenplayAdapterRequest', () => {
  it('emits a result and echoes the adapter identity the host records', async () => {
    const messages = await run({
      adapter: adapter(() =>
        Promise.resolve({ convertedFountain: '!Line', elements: [element('a')], warnings: [] }),
      ),
    });
    const result = terminal(messages);
    expect(result).toMatchObject({
      type: 'result',
      requestId: 'request-1',
      protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
      adapter: { id: 'coda.spec', version: '1' },
      convertedFountain: '!Line',
    });
  });

  it('reports an unregistered format rather than throwing', async () => {
    expect(terminal(await run({ adapter: undefined }))).toMatchObject({
      type: 'failure',
      reason: 'unsupported-format',
    });
  });

  it('refuses an original above the input ceiling before loading any adapter', async () => {
    const resolve = vi.fn();
    const emitted: ScreenplayAdapterWorkerMessage[] = [];
    await executeScreenplayAdapterRequest({
      request: request(),
      bytes: new Uint8Array(limits.maxInputBytes + 1),
      emit: (message) => emitted.push(message),
      resolve,
    });
    expect(terminal(emitted)).toMatchObject({ type: 'failure', reason: 'input-too-large' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects converted Fountain above the output ceiling inside the boundary', async () => {
    const messages = await run({
      adapter: adapter(() =>
        Promise.resolve({
          convertedFountain: 'x'.repeat(limits.maxOutputCharacters + 1),
          elements: [],
          warnings: [],
        }),
      ),
    });
    expect(terminal(messages)).toMatchObject({ type: 'failure', reason: 'output-too-large' });
  });

  it('rejects a report above the element ceiling', async () => {
    const messages = await run({
      adapter: adapter(() =>
        Promise.resolve({
          convertedFountain: '!Line',
          elements: [element('a'), element('b'), element('c')],
          warnings: [],
        }),
      ),
    });
    expect(terminal(messages)).toMatchObject({ type: 'failure', reason: 'element-limit' });
  });

  it('rejects a report above the warning ceiling', async () => {
    const messages = await run({
      adapter: adapter(() =>
        Promise.resolve({
          convertedFountain: '!Line',
          elements: [],
          warnings: [
            { code: 'a', message: 'first' },
            { code: 'b', message: 'second' },
          ],
        }),
      ),
    });
    expect(terminal(messages)).toMatchObject({ type: 'failure', reason: 'element-limit' });
  });

  it('keeps an adapter source rejection attributable', async () => {
    const messages = await run({
      adapter: adapter(() => Promise.reject(new ScreenplayAdapterSourceError('DOCTYPE rejected'))),
    });
    expect(terminal(messages)).toMatchObject({
      type: 'failure',
      reason: 'invalid-source',
      message: 'DOCTYPE rejected',
    });
  });

  it('never lets an unexpected adapter error describe itself', async () => {
    const messages = await run({
      adapter: adapter(() => Promise.reject(new TypeError('C:\\secret\\path exploded'))),
    });
    expect(terminal(messages)).toMatchObject({
      type: 'failure',
      reason: 'invalid-source',
      message: 'Document could not be converted',
    });
  });

  it('aborts the adapter context at the soft deadline and reports a timeout', async () => {
    const messages = await run({
      request: request({ limits: { ...limits, timeoutMs: 1_000 } }),
      adapter: adapter(
        (_input, context) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              try {
                context.throwIfCancelled();
              } catch (error) {
                reject(error instanceof Error ? error : new Error('cancelled'));
              }
            });
          }),
      ),
    });
    expect(terminal(messages)).toMatchObject({ type: 'failure', reason: 'timeout' });
  }, 10_000);

  it('discards a result an adapter produced after its deadline had already passed', async () => {
    const messages = await run({
      request: request({ limits: { ...limits, timeoutMs: 1_000 } }),
      adapter: adapter(async (_input, context) => {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return { convertedFountain: '!Late', elements: [], warnings: [] };
      }),
    });
    expect(terminal(messages)).toMatchObject({ type: 'failure', reason: 'timeout' });
  }, 10_000);

  it('forwards clamped progress and drops progress once cancelled', async () => {
    const messages = await run({
      adapter: adapter((_input, context) => {
        context.reportProgress({ stage: 'pages'.padEnd(200, '!'), completed: -5, total: 10.9 });
        return Promise.resolve({ convertedFountain: '!Line', elements: [], warnings: [] });
      }),
    });
    const progress = messages.find((message) => message.type === 'progress');
    expect(progress).toMatchObject({ progress: { completed: 0, total: 10 } });
    expect(progress?.type === 'progress' && progress.progress.stage.length).toBe(80);
  });
});
