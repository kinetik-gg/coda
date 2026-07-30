import { describe, expect, it } from 'vitest';
import {
  GATED_SCREENPLAY_SOURCE_FORMATS,
  loadScreenplayAdapter,
  registeredScreenplaySourceFormats,
} from './screenplay-adapter-registry';
import { FDX_SOURCE_FORMAT } from './adapters/fdx.adapter';
import { HTML_SOURCE_FORMAT } from './adapters/html.adapter';
import { RTF_SOURCE_FORMAT } from './adapters/rtf.adapter';
import { RUNTIME_TEST_SOURCE_FORMAT } from './adapters/runtime-test.adapter';

describe('screenplay adapter registry', () => {
  it('registers the runtime test adapter and gates it', () => {
    expect(registeredScreenplaySourceFormats()).toContain(RUNTIME_TEST_SOURCE_FORMAT);
    expect(GATED_SCREENPLAY_SOURCE_FORMATS).toContain(RUNTIME_TEST_SOURCE_FORMAT);
  });

  it('registers the FDX adapter, ungated', () => {
    expect(registeredScreenplaySourceFormats()).toContain(FDX_SOURCE_FORMAT);
    expect(GATED_SCREENPLAY_SOURCE_FORMATS).not.toContain(FDX_SOURCE_FORMAT);
  });

  it('loads the FDX adapter lazily and checks it answers for its format', async () => {
    const adapter = await loadScreenplayAdapter(FDX_SOURCE_FORMAT);
    expect(adapter?.id).toBe('coda.fdx');
    expect(adapter?.sourceFormats).toContain(FDX_SOURCE_FORMAT);
  });

  it('registers the HTML adapter, ungated', () => {
    expect(registeredScreenplaySourceFormats()).toContain(HTML_SOURCE_FORMAT);
    expect(GATED_SCREENPLAY_SOURCE_FORMATS).not.toContain(HTML_SOURCE_FORMAT);
  });

  it('loads the HTML adapter lazily and checks it answers for its format', async () => {
    const adapter = await loadScreenplayAdapter(HTML_SOURCE_FORMAT);
    expect(adapter?.id).toBe('coda.html');
    expect(adapter?.sourceFormats).toContain(HTML_SOURCE_FORMAT);
  });

  it('registers the RTF adapter, ungated', () => {
    expect(registeredScreenplaySourceFormats()).toContain(RTF_SOURCE_FORMAT);
    expect(GATED_SCREENPLAY_SOURCE_FORMATS).not.toContain(RTF_SOURCE_FORMAT);
  });

  it('loads the RTF adapter lazily and checks it answers for its format', async () => {
    const adapter = await loadScreenplayAdapter(RTF_SOURCE_FORMAT);
    expect(adapter?.id).toBe('coda.rtf');
    expect(adapter?.sourceFormats).toContain(RTF_SOURCE_FORMAT);
  });

  it('loads an adapter lazily and checks it answers for the requested format', async () => {
    const adapter = await loadScreenplayAdapter(RUNTIME_TEST_SOURCE_FORMAT);
    expect(adapter?.id).toBe('coda.runtime-test');
    expect(adapter?.sourceFormats).toContain(RUNTIME_TEST_SOURCE_FORMAT);
  });

  it('returns nothing for a format with no adapter rather than throwing', async () => {
    await expect(loadScreenplayAdapter('rtfd')).resolves.toBeUndefined();
  });
});
