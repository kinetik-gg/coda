import { describe, expect, it, vi } from 'vitest';
import {
  ScreenplayAdapterAbortError,
  ScreenplayAdapterSourceError,
  screenplayConversionReportSchema,
} from '@coda/contracts';
import type { ScreenplayAdapterContext, ScreenplayAdapterLimits } from '@coda/contracts';
import {
  billionLaughsXml,
  buildZip,
  liedDeclaredSizeFixture,
} from '../../parser-qualification/adversarial-zip-fixtures';
import {
  buildDocxFixture,
  contentTypeEscapeDocxFixture,
  deeplyNestedDocxFixture,
  docxDocumentXml,
  duplicatePartDocxFixture,
  macroContentTypeDocxFixture,
  macroDocxFixture,
  nestedArchiveDocxFixture,
  relationshipEscapeDocxFixture,
  SCREENPLAY_PARAGRAPHS,
  traversalDocxFixture,
  unstyledScreenplayDocxFixture,
} from '../../parser-qualification/docx-fixtures';
import { createDocxAdapter, DOCX_SOURCE_FORMAT } from './docx.adapter';

const DEFAULT_LIMITS: ScreenplayAdapterLimits = {
  timeoutMs: 30_000,
  maxInputBytes: 20_971_520,
  maxOutputCharacters: 5_000_000,
  maxElements: 50_000,
  maxWarnings: 1_000,
};

function context(
  overrides: Partial<ScreenplayAdapterLimits> = {},
  controller = new AbortController(),
): ScreenplayAdapterContext & { progress: { stage: string }[] } {
  const progress: { stage: string }[] = [];
  return {
    signal: controller.signal,
    limits: { ...DEFAULT_LIMITS, ...overrides },
    progress,
    reportProgress: (update) => progress.push({ stage: update.stage }),
    throwIfCancelled: () => {
      if (controller.signal.aborted) throw new ScreenplayAdapterAbortError();
    },
  };
}

function convert(archive: Buffer, ctx: ScreenplayAdapterContext = context()) {
  return createDocxAdapter().convert(
    {
      sourceFormat: DOCX_SOURCE_FORMAT,
      originalFilename: 'pilot.docx',
      bytes: new Uint8Array(archive),
    },
    ctx,
  );
}

describe('DOCX adapter: valid packages', () => {
  it('declares its identity and source format', () => {
    const adapter = createDocxAdapter();
    expect(adapter.id).toBe('coda.docx');
    expect(adapter.version).toBe('1');
    expect(adapter.sourceFormats).toEqual([DOCX_SOURCE_FORMAT]);
  });

  it('converts a styled screenplay package to Fountain', async () => {
    const output = await convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }));
    expect(output.convertedFountain).toContain('Title: The Long Way Down');
    expect(output.convertedFountain).toContain('Author: Rae Dominguez');
    expect(output.convertedFountain).toContain('INT. RADIO STATION - NIGHT');
    expect(output.convertedFountain).toContain('RAE');
    expect(output.convertedFountain).toContain('(still on air)');
    expect(output.convertedFountain).toContain(
      "It's three in the morning and nobody is listening.",
    );
    expect(output.convertedFountain).toContain('CUT TO:');
  });

  it('produces a schema-valid report whose target ranges point at the converted text', async () => {
    const output = await convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }));
    const report = screenplayConversionReportSchema.parse({
      schemaVersion: 1,
      sourceFormat: DOCX_SOURCE_FORMAT,
      adapter: { id: 'coda.docx', version: '1' },
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
    expect(report.summary.converted).toBe(SCREENPLAY_PARAGRAPHS.length);
    const heading = output.elements.find((element) => element.target?.kind === 'scene-heading');
    expect(heading).toBeDefined();
    const { start, end } = heading!.target!.location;
    expect(output.convertedFountain.slice(start, end)).toBe('INT. RADIO STATION - NIGHT');
  });

  it('reports every paragraph against its source paragraph index', async () => {
    const output = await convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }));
    expect(output.elements).toHaveLength(SCREENPLAY_PARAGRAPHS.length);
    for (const [index, element] of output.elements.entries()) {
      expect(element.source).toMatchObject({
        kind: 'docx-paragraph',
        location: { unit: 'paragraph', start: index, end: index + 1 },
      });
    }
  });

  it('classifies an unstyled script from its text and says so', async () => {
    const output = await convert(unstyledScreenplayDocxFixture());
    expect(output.warnings.map((warning) => warning.code)).toContain('DOCX_STYLES_MISSING');
    expect(output.convertedFountain).toContain('INT. RADIO STATION - NIGHT');
    expect(output.convertedFountain).toContain('RAE');
    const guessed = output.elements.filter((element) => element.status === 'uncertain');
    expect(guessed.length).toBeGreaterThan(0);
    expect(guessed[0]?.summary).toContain('carries no screenplay style');
  });

  it('forces Fountain syntax rather than re-casing text that would be misread', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          { text: 'The rooftop, later', style: 'SceneHeading' },
          { text: 'Rae Dominguez', style: 'Character' },
          { text: 'Hello.', style: 'Dialogue' },
          { text: 'Later that night', style: 'Transition' },
        ],
      }),
    );
    // `@coda/fountain`'s own scene-heading rule is case-insensitive, so only a
    // heading with no INT./EXT. prefix at all actually needs forcing.
    expect(output.convertedFountain).toContain('.The rooftop, later');
    expect(output.convertedFountain).toContain('@Rae Dominguez');
    expect(output.convertedFountain).toContain('> Later that night');
  });

  it('emits a page break for a paragraph that only breaks the page', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          { text: 'Before.', style: 'Action' },
          { pageBreakBefore: true },
          { text: 'After.', style: 'Action' },
        ],
      }),
    );
    expect(output.convertedFountain).toContain('===');
  });

  it('reports progress for each stage of the package walk', async () => {
    const ctx = context();
    await convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }), ctx);
    expect(ctx.progress.map((entry) => entry.stage)).toEqual(['package', 'styles', 'document']);
  });

  it('resolves a main document part named by the package relationship, not by convention', async () => {
    const archive = buildDocxFixture({
      omitDocument: true,
      packageRelsXml:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document2.xml"/>' +
        '</Relationships>',
      extraEntries: [
        {
          name: 'word/document2.xml',
          data: docxDocumentXml([{ text: 'FADE IN:', style: 'Action' }]),
        },
      ],
    });
    const output = await convert(archive);
    expect(output.convertedFountain).toContain('FADE IN:');
  });
});

describe('DOCX adapter: degraded constructs', () => {
  it('flattens table text and marks it uncertain', async () => {
    const output = await convert(
      buildDocxFixture({ paragraphs: [{ text: 'In a cell.', style: 'Action', inTable: true }] }),
    );
    expect(output.elements[0]?.status).toBe('uncertain');
    expect(output.elements[0]?.warnings.map((warning) => warning.code)).toContain(
      'DOCX_TABLE_FLATTENED',
    );
  });

  it('reports list numbering as lost, resolved through the numbering part', async () => {
    const output = await convert(
      buildDocxFixture({ paragraphs: [{ text: 'One.', style: 'Action', numId: '1' }] }),
    );
    const warning = output.elements[0]?.warnings.find(
      (entry) => entry.code === 'DOCX_LIST_NUMBERING_LOST',
    );
    expect(warning?.message).toContain('decimal');
  });

  it('marks an embedded drawing unsupported without opening it', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          { text: 'A photo sits here.', style: 'Action', extra: '<w:r><w:drawing/></w:r>' },
        ],
      }),
    );
    expect(output.elements[0]?.status).toBe('unsupported');
    expect(output.elements[0]?.warnings.map((warning) => warning.code)).toContain(
      'DOCX_EMBEDDED_OBJECT_DROPPED',
    );
  });

  it('drops field-code instructions instead of importing them as dialogue', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          {
            text: 'Page ',
            style: 'Action',
            extra: '<w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r>',
          },
        ],
      }),
    );
    expect(output.convertedFountain).not.toContain('MERGEFORMAT');
    expect(output.elements[0]?.warnings.map((warning) => warning.code)).toContain(
      'DOCX_FIELD_CODE_DROPPED',
    );
  });

  it('excludes tracked deletions and keeps insertions', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          {
            text: 'Kept text.',
            style: 'Action',
            extra: '<w:del><w:r><w:delText>Deleted text.</w:delText></w:r></w:del>',
          },
        ],
      }),
    );
    expect(output.convertedFountain).toContain('Kept text.');
    expect(output.convertedFountain).not.toContain('Deleted text.');
    expect(output.elements[0]?.warnings.map((warning) => warning.code)).toContain(
      'DOCX_TRACKED_CHANGE',
    );
  });

  it('keeps an external hyperlink as text and never dereferences it', async () => {
    const output = await convert(
      buildDocxFixture({
        paragraphs: [
          {
            style: 'Action',
            extra: '<w:hyperlink r:id="rId10"><w:r><w:t>the notes</w:t></w:r></w:hyperlink>',
          },
        ],
      }),
    );
    expect(output.convertedFountain).toContain('the notes');
    expect(output.convertedFountain).not.toContain('example.test');
    expect(output.elements[0]?.warnings.map((warning) => warning.code)).toContain(
      'DOCX_EXTERNAL_LINK_NOT_FOLLOWED',
    );
  });

  it('counts non-XML parts as retained-but-not-imported rather than reading them', async () => {
    const output = await convert(nestedArchiveDocxFixture());
    const warning = output.warnings.find((entry) => entry.code === 'DOCX_BINARY_PARTS_SKIPPED');
    expect(warning?.message).toContain('not imported');
  });

  it('rejects a package with no importable text', async () => {
    await expect(convert(buildDocxFixture({ paragraphs: [{ text: '' }] }))).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });
});

describe('DOCX adapter: hostile packages', () => {
  it('rejects a macro-bearing package by entry name', async () => {
    await expect(convert(macroDocxFixture())).rejects.toThrow(/macros/iu);
  });

  it('rejects a macro-enabled content type', async () => {
    await expect(convert(macroContentTypeDocxFixture())).rejects.toThrow(/macros/iu);
  });

  it.each([
    ['word/document.xml', { documentXml: billionLaughsXml(3, 3) }],
    ['word/styles.xml', { stylesXml: billionLaughsXml(3, 3) }],
    ['word/numbering.xml', { numberingXml: billionLaughsXml(3, 3) }],
    ['[Content_Types].xml', { contentTypesXml: billionLaughsXml(3, 3) }],
    ['word/_rels/document.xml.rels', { documentRelsXml: billionLaughsXml(3, 3) }],
    ['_rels/.rels', { packageRelsXml: billionLaughsXml(3, 3) }],
  ])('rejects entity expansion in %s', async (_part, options) => {
    // Three levels of three-fold self-reference is enough: the preflight rejects
    // the `<!ENTITY` declaration itself, so the expansion never has to be large
    // to prove it is refused.
    await expect(convert(buildDocxFixture(options))).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('rejects a path-traversal entry name', async () => {
    await expect(convert(traversalDocxFixture())).rejects.toThrow(/escape the package/iu);
  });

  it('rejects a package that repeats a part', async () => {
    await expect(convert(duplicatePartDocxFixture())).rejects.toThrow(/same part twice/iu);
  });

  it('rejects a relationship target that resolves outside the package', async () => {
    await expect(convert(relationshipEscapeDocxFixture())).rejects.toThrow(
      /resolves outside the package/iu,
    );
  });

  it('rejects a content-type override that names a relative part', async () => {
    await expect(convert(contentTypeEscapeDocxFixture())).rejects.toThrow(/relative part/iu);
  });

  it('rejects XML nested past the preflight depth ceiling', async () => {
    await expect(convert(deeplyNestedDocxFixture(120))).rejects.toThrow(/element depth/iu);
  });

  it('rejects an entry whose declared size is over the ceiling, before inflating it', async () => {
    // 8 KiB declared against a 4 KiB ceiling. The verdict comes from the central
    // directory, so the size only has to cross the cap — which is why the cap is
    // shrunk here instead of the fixture being grown.
    const archive = buildDocxFixture({
      extraEntries: [{ name: 'word/media/image1.png', data: Buffer.alloc(8192, 0x41) }],
    });
    await expect(convert(archive, context({ maxInputBytes: 4096 }))).rejects.toThrow(
      /declares more data than the import ceiling/iu,
    );
  });

  it('rejects an entry compressed past the ratio cap even when its size fits', async () => {
    const archive = buildDocxFixture({
      extraEntries: [{ name: 'word/media/image1.png', data: Buffer.alloc(256 * 1024, 0) }],
    });
    await expect(convert(archive)).rejects.toThrow(/compressed far beyond/iu);
  });

  it('rejects an entry that produces more bytes than it declared, mid-inflation', async () => {
    await expect(convert(liedDeclaredSizeFixture(100, 200 * 1024))).rejects.toThrow(
      ScreenplayAdapterSourceError,
    );
  });

  it('rejects a package with more entries than the cap', async () => {
    const entries = Array.from({ length: 600 }, (_unused, index) => ({
      name: `word/media/file-${index}.bin`,
      data: Buffer.from(`${index}`, 'utf8'),
      deflate: false,
    }));
    await expect(convert(buildZip(entries))).rejects.toThrow(/too many parts/iu);
  });

  it('rejects a package whose parts are individually small but collectively over the cap', async () => {
    const archive = buildDocxFixture({
      // Incompressible bytes on purpose: a repeated character would trip the
      // ratio cap first and prove a different guard than this test names.
      extraEntries: Array.from({ length: 6 }, (_unused, index) => ({
        name: `word/media/image-${index}.png`,
        data: Buffer.from(Array.from({ length: 4096 }, (_byte, at) => (at * 37 + index) % 251)),
      })),
    });
    await expect(convert(archive, context({ maxInputBytes: 4096 }))).rejects.toThrow(
      /more data in total/iu,
    );
  });

  it('rejects a file that is not a ZIP archive at all', async () => {
    await expect(convert(Buffer.from('This is a plain text file.', 'utf8'))).rejects.toThrow(
      /not a DOCX package/iu,
    );
  });

  it('rejects a package with no main document part', async () => {
    await expect(convert(buildDocxFixture({ omitDocument: true }))).rejects.toThrow(
      /no main document part/iu,
    );
  });

  it('rejects a main part whose root element is not a WordprocessingML document', async () => {
    await expect(
      convert(buildDocxFixture({ documentXml: '<html><body>Not Word.</body></html>' })),
    ).rejects.toThrow(/WordprocessingML/iu);
  });

  it('rejects malformed XML rather than importing a partial document', async () => {
    await expect(
      convert(buildDocxFixture({ documentXml: '<w:document><w:body><w:p></w:document>' })),
    ).rejects.toThrow(ScreenplayAdapterSourceError);
  });

  it('stops one line past the output ceiling so the runtime can attribute it', async () => {
    const ctx = context({ maxOutputCharacters: 40 });
    const output = await convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }), ctx);
    expect(output.convertedFountain.length).toBeGreaterThan(40);
    expect(output.warnings.map((warning) => warning.code)).toContain('DOCX_DOCUMENT_TRUNCATED');
  });

  it('stops one element past the element ceiling so the runtime can attribute it', async () => {
    const output = await convert(
      buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }),
      context({ maxElements: 4 }),
    );
    expect(output.elements.length).toBeGreaterThan(4);
    expect(output.elements.length).toBeLessThan(SCREENPLAY_PARAGRAPHS.length);
  });

  it('cooperates with cancellation before reading the archive', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }), context({}, controller)),
    ).rejects.toThrow(ScreenplayAdapterAbortError);
  });

  it('cooperates with cancellation raised while the document is being walked', async () => {
    const controller = new AbortController();
    const ctx = context({}, controller);
    const throwIfCancelled = vi.spyOn(ctx, 'throwIfCancelled');
    throwIfCancelled.mockImplementationOnce(() => undefined);
    throwIfCancelled.mockImplementation(() => {
      throw new ScreenplayAdapterAbortError();
    });
    await expect(
      convert(buildDocxFixture({ paragraphs: SCREENPLAY_PARAGRAPHS }), ctx),
    ).rejects.toThrow(ScreenplayAdapterAbortError);
  });
});
