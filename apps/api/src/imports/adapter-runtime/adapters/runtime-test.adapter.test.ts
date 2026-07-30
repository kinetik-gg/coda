import { describe, expect, it } from 'vitest';
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext, ScreenplayAdapterProgress } from '@coda/contracts';
import { RUNTIME_TEST_SOURCE_FORMAT, createRuntimeTestAdapter } from './runtime-test.adapter';

const limits = {
  timeoutMs: 1_000,
  maxInputBytes: 1_048_576,
  maxOutputCharacters: 1_000_000,
  maxElements: 50_000,
  maxWarnings: 100,
};

function context(controller = new AbortController()) {
  const progress: ScreenplayAdapterProgress[] = [];
  const value: ScreenplayAdapterContext = {
    signal: controller.signal,
    limits,
    reportProgress: (entry) => progress.push(entry),
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
  return { context: value, controller, progress };
}

function convert(source: string, harness = context()) {
  return createRuntimeTestAdapter().convert(
    {
      sourceFormat: RUNTIME_TEST_SOURCE_FORMAT,
      originalFilename: 'fixture.demo',
      bytes: new TextEncoder().encode(source),
    },
    harness.context,
  );
}

describe('runtime test adapter', () => {
  it('converts each line into forced action with a matching report element', async () => {
    const output = await convert('INT. ROOM - DAY\n\nShe waits.');
    expect(output.convertedFountain).toBe('!INT. ROOM - DAY\n\n!She waits.');
    expect(output.elements).toHaveLength(2);
    expect(output.elements[0]).toMatchObject({
      id: 'line-1',
      status: 'converted',
      source: { location: { unit: 'line', start: 0, end: 1 } },
    });
  });

  it('reports progress for a long document', async () => {
    const harness = context();
    await convert(Array.from({ length: 1_200 }, (_, index) => `Line ${index}`).join('\n'), harness);
    expect(harness.progress.length).toBeGreaterThanOrEqual(2);
    expect(harness.progress[0]).toMatchObject({ stage: 'lines', total: 1_200 });
  });

  it('rejects an empty document', async () => {
    await expect(convert('   \n\n  ')).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects on the reject directive and on an unknown directive', async () => {
    await expect(convert('#!reject')).rejects.toThrow('Runtime test document was rejected');
    await expect(convert('#!nonsense')).rejects.toThrow('Unknown runtime test directive');
  });

  it('stops cooperatively when the context is aborted mid-sleep', async () => {
    const harness = context();
    const running = convert('#!sleep:10000\nHello', harness);
    harness.controller.abort();
    await expect(running).rejects.toThrow(ScreenplayAdapterAbortError);
  });

  it('honours a cancellation raised between lines', async () => {
    const harness = context();
    harness.controller.abort();
    await expect(convert('One\nTwo', harness)).rejects.toThrow(ScreenplayAdapterAbortError);
  });

  it('emits oversized output on demand so the output ceiling can be exercised', async () => {
    const output = await convert('#!flood:5000');
    expect(output.convertedFountain.length).toBe(5_000);
  });

  it('emits an oversized element count on demand', async () => {
    const output = await convert('#!swarm:120');
    expect(output.elements).toHaveLength(120);
    expect(output.elements.every((element) => element.status === 'uncertain')).toBe(true);
  });

  it('rejects bytes that are not valid UTF-8', async () => {
    const adapter = createRuntimeTestAdapter();
    await expect(
      adapter.convert(
        {
          sourceFormat: RUNTIME_TEST_SOURCE_FORMAT,
          originalFilename: 'fixture.demo',
          bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
        },
        context().context,
      ),
    ).rejects.toThrow();
  });

  it('declares only its own synthetic format', () => {
    const adapter = createRuntimeTestAdapter();
    expect(adapter.sourceFormats).toEqual([RUNTIME_TEST_SOURCE_FORMAT]);
    expect(adapter.id).toBe('coda.runtime-test');
    expect(adapter.version).toBe('1');
  });
});
