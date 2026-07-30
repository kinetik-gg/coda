import { describe, expect, it } from 'vitest';
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext } from '@coda/contracts';
import { screenplayConversionReportSchema } from '@coda/contracts';
import { createPdfAdapter, PDF_SOURCE_FORMAT } from './pdf.adapter';
import { buildScreenplayPdf, type PdfFixtureLine } from './pdf-test-fixtures';
import { PDFDocument } from 'pdf-lib';

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
      /* not exercised by this adapter's per-page cadence in these tests */
    },
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
}

async function convert(bytes: Uint8Array, ctx = context()) {
  return createPdfAdapter().convert(
    { sourceFormat: PDF_SOURCE_FORMAT, originalFilename: 'script.pdf', bytes },
    ctx,
  );
}

const SCREENPLAY_PAGE: readonly PdfFixtureLine[] = [
  { kind: 'scene_heading', text: 'EXT. STREET - DAY' },
  { kind: 'action', text: 'Rain falls on the empty road.' },
  { kind: 'character', text: 'RILEY' },
  { kind: 'dialogue', text: 'We should go now.' },
  { kind: 'parenthetical', text: '(beat)' },
  { kind: 'dialogue', text: 'Right now.' },
  { kind: 'transition', text: 'CUT TO:' },
];

describe('PDF adapter', () => {
  it('declares its identity and source format', () => {
    const adapter = createPdfAdapter();
    expect(adapter.id).toBe('coda.pdf');
    expect(adapter.version).toBe('1');
    expect(adapter.sourceFormats).toEqual([PDF_SOURCE_FORMAT]);
  });

  it('converts a text-based screenplay PDF to Fountain', async () => {
    const bytes = await buildScreenplayPdf([SCREENPLAY_PAGE]);
    const output = await convert(bytes);
    expect(output.convertedFountain).toContain('EXT. STREET - DAY');
    expect(output.convertedFountain).toContain('@RILEY');
    expect(output.convertedFountain).toContain('We should go now.');
    expect(output.convertedFountain).toContain('(beat)');
    expect(output.convertedFountain).toContain('>CUT TO:');
  });

  it('produces a schema-valid, non-empty per-element report attributing each block to its page', async () => {
    const bytes = await buildScreenplayPdf([SCREENPLAY_PAGE]);
    const output = await convert(bytes);
    expect(output.elements.length).toBeGreaterThan(0);
    const report = screenplayConversionReportSchema.parse({
      schemaVersion: 1,
      sourceFormat: PDF_SOURCE_FORMAT,
      adapter: { id: 'coda.pdf', version: '1' },
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
    expect(report.elements.every((element) => element.source.location.unit === 'page')).toBe(true);
    const sceneHeading = report.elements.find(
      (element) => element.target?.kind === 'scene_heading',
    );
    expect(sceneHeading?.source.location).toEqual({ unit: 'page', start: 0, end: 1 });
  });

  it('attributes elements to the PDF page they were extracted from', async () => {
    const bytes = await buildScreenplayPdf([
      [{ kind: 'action', text: 'Page one action.' }],
      [{ kind: 'action', text: 'Page two action.' }],
    ]);
    const output = await convert(bytes);
    const pageIndices = output.elements.map((element) => element.source.location.start);
    expect(pageIndices).toContain(0);
    expect(pageIndices).toContain(1);
  });

  it('reports an indentation-only classification as uncertain, with an ambiguity warning', async () => {
    const bytes = await buildScreenplayPdf([[{ kind: 'action', text: 'MEANWHILE' }]]);
    const output = await convert(bytes);
    const uncertain = output.elements.find((element) => element.status === 'uncertain');
    expect(uncertain).toBeDefined();
    expect(uncertain?.warnings).toEqual([
      expect.objectContaining({ code: 'PDF_LAYOUT_AMBIGUOUS' }),
    ]);
  });

  it('rejects a scanned (no text layer) PDF explicitly, without attempting OCR', async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    const bytes = await document.save();
    const error: unknown = await convert(bytes).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ScreenplayAdapterSourceError);
    expect((error as Error).message).toMatch(/scanned or image-only/u);
    expect((error as Error).message).toMatch(/optical character recognition is not supported/u);
  });

  it('rejects a corrupted or non-PDF file as invalid-source', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\nnot actually a pdf');
    await expect(convert(bytes)).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('cooperates with cancellation before doing any conversion work', async () => {
    const bytes = await buildScreenplayPdf([SCREENPLAY_PAGE]);
    const controller = new AbortController();
    controller.abort();
    await expect(convert(bytes, context(controller))).rejects.toThrow(ScreenplayAdapterAbortError);
  });
});
