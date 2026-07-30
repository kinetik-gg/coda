import { describe, expect, it } from 'vitest';
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext } from '@coda/contracts';
import { screenplayConversionReportSchema } from '@coda/contracts';
import { MAX_HTML_BYTES } from '@coda/fountain';
import { createHtmlAdapter, HTML_SOURCE_FORMAT } from './html.adapter';

const SCREENPLAY_HTML =
  '<!DOCTYPE html><html><head><title>Weather</title>' +
  '<script src="https://evil.example/tracker.js"></script>' +
  '<style>.hidden { display: none; }</style></head>' +
  '<body>' +
  '<h1>INT. CAFE - NIGHT</h1>' +
  '<p>Rain falls against the window.</p>' +
  '<p>RILEY</p>' +
  '<p>(quietly)</p>' +
  '<p>We should go.</p>' +
  '<p>CUT TO:</p>' +
  '<div hidden><p>SECRET CONTENT THAT MUST NOT APPEAR</p></div>' +
  '</body></html>';

const limits = {
  timeoutMs: 30_000,
  maxInputBytes: 20_971_520,
  maxOutputCharacters: 5_000_000,
  maxElements: 50_000,
  maxWarnings: 1_000,
};

function context(controller = new AbortController()): ScreenplayAdapterContext {
  return {
    signal: controller.signal,
    limits,
    reportProgress: () => {
      /* not exercised by this synchronous adapter */
    },
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
}

function convert(source: string, ctx = context()) {
  return createHtmlAdapter().convert(
    {
      sourceFormat: HTML_SOURCE_FORMAT,
      originalFilename: 'draft.html',
      bytes: new TextEncoder().encode(source),
    },
    ctx,
  );
}

describe('HTML adapter', () => {
  it('declares its identity and source format', () => {
    const adapter = createHtmlAdapter();
    expect(adapter.id).toBe('coda.html');
    expect(adapter.version).toBe('1');
    expect(adapter.sourceFormats).toEqual([HTML_SOURCE_FORMAT]);
  });

  it('converts screenplay-like HTML to Fountain and performs zero network or resource loads', async () => {
    const output = await convert(SCREENPLAY_HTML);
    expect(output.convertedFountain).toContain('INT. CAFE - NIGHT');
    expect(output.convertedFountain).toContain('RILEY');
    expect(output.convertedFountain).toContain('We should go.');
    expect(output.convertedFountain).toContain('CUT TO:');
    expect(output.convertedFountain).not.toContain('evil.example');
    expect(output.convertedFountain).not.toContain('SECRET CONTENT');
  });

  it('produces a schema-valid, non-empty per-element report', async () => {
    const output = await convert(SCREENPLAY_HTML);
    expect(output.elements.length).toBeGreaterThan(0);
    const report = screenplayConversionReportSchema.parse({
      schemaVersion: 1,
      sourceFormat: HTML_SOURCE_FORMAT,
      adapter: { id: 'coda.html', version: '1' },
      generatedAt: new Date().toISOString(),
      warnings: output.warnings,
      elements: output.elements,
      summary: {
        total: output.elements.length,
        preserved: output.elements.filter((element) => element.status === 'preserved').length,
        converted: output.elements.filter((element) => element.status === 'converted').length,
        uncertain: output.elements.filter((element) => element.status === 'uncertain').length,
        unsupported: output.elements.filter((element) => element.status === 'unsupported').length,
      },
    });
    expect(report.elements.some((element) => element.status === 'converted')).toBe(true);
  });

  it('rejects a doctype carrying an internal subset before any tokenizing, as invalid-source', async () => {
    const source = '<!DOCTYPE html [<!ENTITY x "unsafe">]><html><body><p>x</p></body></html>';
    await expect(convert(source)).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects an oversized document, preserving the existing HTML byte ceiling', async () => {
    const oversized = `<p>${'x'.repeat(MAX_HTML_BYTES)}</p>`;
    await expect(convert(oversized)).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects excessively deep nesting as invalid-source rather than throwing an unclassified error', async () => {
    const nested = '<div>'.repeat(200);
    const closing = '</div>'.repeat(200);
    await expect(convert(`${nested}<p>x</p>${closing}`)).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('rejects a document with no screenplay text', async () => {
    await expect(
      convert('<html><head><title>Empty</title></head><body></body></html>'),
    ).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('tolerates malformed nesting and unclosed optional tags', async () => {
    const output = await convert(
      '<p>INT. HOUSE - DAY<p>Unclosed paragraph.<div><p>Nested without closing div.',
    );
    expect(output.convertedFountain).toContain('INT. HOUSE - DAY');
    expect(output.convertedFountain).toContain('Unclosed paragraph.');
  });

  it('cooperates with cancellation before doing any conversion work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(convert(SCREENPLAY_HTML, context(controller))).rejects.toThrow(
      ScreenplayAdapterAbortError,
    );
  });
});
