import { describe, expect, it } from 'vitest';
import {
  GATED_SCREENPLAY_SOURCE_FORMATS,
  loadScreenplayAdapter,
  registeredScreenplaySourceFormats,
} from './screenplay-adapter-registry';
import { RUNTIME_TEST_SOURCE_FORMAT } from './adapters/runtime-test.adapter';

describe('screenplay adapter registry', () => {
  it('registers the runtime test adapter and gates it', () => {
    expect(registeredScreenplaySourceFormats()).toContain(RUNTIME_TEST_SOURCE_FORMAT);
    expect(GATED_SCREENPLAY_SOURCE_FORMATS).toContain(RUNTIME_TEST_SOURCE_FORMAT);
  });

  it('loads an adapter lazily and checks it answers for the requested format', async () => {
    const adapter = await loadScreenplayAdapter(RUNTIME_TEST_SOURCE_FORMAT);
    expect(adapter?.id).toBe('coda.runtime-test');
    expect(adapter?.sourceFormats).toContain(RUNTIME_TEST_SOURCE_FORMAT);
  });

  it('returns nothing for a format with no adapter rather than throwing', async () => {
    await expect(loadScreenplayAdapter('rtf')).resolves.toBeUndefined();
  });
});
