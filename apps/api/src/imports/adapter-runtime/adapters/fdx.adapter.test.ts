import { describe, expect, it } from 'vitest';
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext } from '@coda/contracts';
import { screenplayConversionReportSchema } from '@coda/contracts';
import { MAX_FDX_BYTES } from '@coda/fountain';
import { createFdxAdapter, FDX_SOURCE_FORMAT } from './fdx.adapter';

const COMPLETE_FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>EXT. CAFE - NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><Text>Rain falls.</Text></Paragraph>
    <Paragraph Type="Character"><Text>RILEY</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>We should go.</Text></Paragraph>
    <Paragraph Type="Shot"><Text>CLOSE ON keys.</Text></Paragraph>
    <Paragraph Type="Widget"><Text>Not a real type.</Text></Paragraph>
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Type="Title"><Text>Weather</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>`;

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
  return createFdxAdapter().convert(
    {
      sourceFormat: FDX_SOURCE_FORMAT,
      originalFilename: 'draft.fdx',
      bytes: new TextEncoder().encode(source),
    },
    ctx,
  );
}

describe('FDX adapter', () => {
  it('declares its identity and source format', () => {
    const adapter = createFdxAdapter();
    expect(adapter.id).toBe('coda.fdx');
    expect(adapter.version).toBe('1');
    expect(adapter.sourceFormats).toEqual([FDX_SOURCE_FORMAT]);
  });

  it('converts a Final Draft document to Fountain matching the underlying importer', async () => {
    const output = await convert(COMPLETE_FDX);
    expect(output.convertedFountain).toContain('Title: Weather');
    expect(output.convertedFountain).toContain('EXT. CAFE - NIGHT');
    expect(output.convertedFountain).toContain('RILEY');
    expect(output.convertedFountain).toContain('We should go.');
  });

  it('produces a schema-valid, non-empty per-element report', async () => {
    const output = await convert(COMPLETE_FDX);
    expect(output.elements.length).toBeGreaterThan(0);
    const report = screenplayConversionReportSchema.parse({
      schemaVersion: 1,
      sourceFormat: FDX_SOURCE_FORMAT,
      adapter: { id: 'coda.fdx', version: '1' },
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

  it('reports a degraded construct as an uncertain element carrying the warning', async () => {
    const output = await convert(COMPLETE_FDX);
    const shotWarning = output.elements.find((element) =>
      element.summary.includes('Shot paragraphs were imported as forced action'),
    );
    expect(shotWarning).toMatchObject({ status: 'uncertain', target: null });
    expect(shotWarning?.warnings).toHaveLength(1);
  });

  it('reports an omitted construct as unsupported', async () => {
    const source =
      '<FinalDraft><Content><Paragraph Type="Action"><Text>Kept.</Text></Paragraph></Content>' +
      '<TitlePage><Content><Paragraph Type="Nonsense"><Text>Dropped.</Text></Paragraph></Content></TitlePage></FinalDraft>';
    const output = await convert(source);
    const omitted = output.elements.find((element) => element.summary.includes('was omitted'));
    expect(omitted).toMatchObject({ status: 'unsupported', target: null });
  });

  it('rejects a DOCTYPE/entity payload before DOM construction, as invalid-source', async () => {
    const source =
      '<!DOCTYPE FinalDraft [<!ENTITY x "unsafe">]><FinalDraft><Content/></FinalDraft>';
    await expect(convert(source)).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects an oversized document, preserving the existing FDX byte ceiling', async () => {
    const oversized = `<FinalDraft><Content><Paragraph Type="Action"><Text>${'x'.repeat(
      MAX_FDX_BYTES,
    )}</Text></Paragraph></Content></FinalDraft>`;
    await expect(convert(oversized)).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects malformed XML as invalid-source rather than throwing an unclassified error', async () => {
    await expect(convert('<FinalDraft><Content></FinalDraft>')).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('cooperates with cancellation before doing any conversion work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(convert(COMPLETE_FDX, context(controller))).rejects.toThrow(
      ScreenplayAdapterAbortError,
    );
  });
});
