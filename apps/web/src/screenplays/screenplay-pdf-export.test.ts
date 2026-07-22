// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalScreenplayPdfFilename,
  createScreenplayPdf,
  downloadScreenplayPdf,
  layoutScreenplayPdf,
} from './screenplay-pdf-export';
import { type ScreenplayLayoutLine, type ScreenplayPreviewModel } from './screenplay-preview-model';
import { screenplayPaper, type ScreenplayPaperSize } from './screenplay-paper';

const fontDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../assets/fonts/courier-prime',
);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const source = requestUrl(input);
      const filename = basename(source.split('?')[0] ?? source);
      return new Response(await readFile(join(fontDirectory, filename)), { status: 200 });
    }),
  );
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return 'url' in input ? input.url : input.href;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screenplay PDF export', () => {
  it.each([
    ['draft.fountain', 'draft.pdf'],
    ['draft.spmd', 'draft.pdf'],
    ['draft.txt', 'draft.pdf'],
    ['draft.pdf', 'draft.pdf'],
    ['', 'screenplay.pdf'],
  ])('canonicalizes %j as %j', (source, expected) => {
    expect(canonicalScreenplayPdfFilename(source)).toBe(expected);
  });

  it('uses canonical lines without wrapping, repositioning, or repagination', () => {
    const line = canonicalLine({
      text: 'ONE VERY LONG CANONICAL LINE',
      x: 100.75,
      baselineY: 765.25,
      width: 29,
      columns: 4,
      inlineStyles: [{ kind: 'bold', from: 4, to: 13 }],
    });
    const layout = layoutScreenplayPdf(modelWithPages('a4', [[line]]));

    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.runs).toEqual([
      expect.objectContaining({
        text: line.text,
        x: line.x,
        y: line.baselineY,
        inlineStyles: line.inlineStyles,
      }),
    ]);
  });

  it('adds canonical page, scene, and revision marks without changing body placement', () => {
    const paper = screenplayPaper('a4');
    const scene = canonicalLine({
      kind: 'scene-heading',
      text: 'INT. ROOM - DAY',
      font: 'bold',
      sceneNumber: '12A',
      revisionMarker: '@@',
    });
    const layout = layoutScreenplayPdf(modelWithPages('a4', [[], [scene]]));
    const runs = layout.pages[1]!.runs;

    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'page-number', text: '2.' }),
        expect.objectContaining({ role: 'scene-heading', x: scene.x, y: scene.baselineY }),
        expect.objectContaining({ role: 'revision-mark', text: '@@', x: paper.revisionMarkLeft }),
        expect.objectContaining({
          role: 'scene-number',
          text: '12A',
          x: paper.sceneNumberLeft,
        }),
        expect.objectContaining({
          role: 'scene-number',
          text: '12A',
          x: paper.sceneNumberRight,
          align: 'right',
        }),
      ]),
    );
  });

  it('maps title lines and honors a forced printed page number on screenplay page one', () => {
    const titleLine = canonicalLine({
      kind: 'title-page',
      text: 'BLUE HOUR',
      align: 'center',
      font: 'regular',
    });
    const bodyLine = canonicalLine({ text: 'First body page.' });
    const base = modelWithPages('a4', []);
    const layout = layoutScreenplayPdf({
      ...base,
      pages: [
        { id: 'title', pageNumber: null, blocks: [], lines: [titleLine] },
        {
          id: 'body',
          pageNumber: 1,
          printedPageNumber: '3A',
          blocks: [],
          lines: [bodyLine],
        },
      ],
    });

    expect(layout.pages[0]).toMatchObject({ kind: 'title', pageNumber: null });
    expect(layout.pages[0]!.runs[0]).toMatchObject({
      role: 'title-field',
      align: 'center',
    });
    expect(layout.pages[1]!.runs[0]).toMatchObject({
      role: 'page-number',
      text: '3A.',
      align: 'right',
    });
  });

  it('builds a canonical model when given Fountain source text', () => {
    const layout = layoutScreenplayPdf('Title: Blue Hour\n\nINT. ROOM - DAY', 'a4');

    expect(layout.paperSize).toBe('a4');
    expect(layout.pages.map((page) => page.kind)).toEqual(['title', 'body']);
    expect(layout.pages[0]!.runs).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'title-field', text: 'BLUE HOUR' })]),
    );
  });

  it.each([
    ['a4', 595, 842],
    ['letter', 612, 792],
  ] as const)(
    'creates an exact %s page with embedded Courier Prime',
    async (size, width, height) => {
      const bytes = await createScreenplayPdf(
        modelWithPages(size, [
          [
            canonicalLine({
              text: 'Smart quotes “work”, café.',
              inlineStyles: [
                { kind: 'bold_italic', from: 0, to: 12 },
                { kind: 'underline', from: 13, to: 17 },
              ],
            }),
          ],
        ]),
      );

      expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.3');
      const document = await PDFDocument.load(bytes);
      expect(document.getPages()[0]!.getSize()).toEqual({ width, height });
      const source = new TextDecoder('latin1').decode(bytes);
      expect(source).toContain('CourierPrime');
      expect(source).not.toContain('/Courier ');
    },
  );

  it('renders every font combination, alignment, underline, and clamp branch', async () => {
    const lines = [
      canonicalLine({ id: 'bold', text: 'Bold', font: 'bold', baselineY: 715 }),
      canonicalLine({ id: 'italic', text: 'Italic', font: 'italic', baselineY: 703 }),
      canonicalLine({
        id: 'bold-italic',
        text: 'Bold italic',
        font: 'bold-italic',
        baselineY: 691,
      }),
      canonicalLine({
        id: 'styled',
        text: 'BOLD ITALIC BOTH UNDER',
        baselineY: 679,
        inlineStyles: [
          { kind: 'bold', from: -5, to: 4 },
          { kind: 'italic', from: 5, to: 11 },
          { kind: 'bold_italic', from: 12, to: 16 },
          { kind: 'underline', from: 17, to: 99 },
        ],
      }),
      canonicalLine({
        id: 'bold-plus-italic',
        text: 'Combined',
        font: 'bold',
        baselineY: 667,
        inlineStyles: [{ kind: 'italic', from: 0, to: 8 }],
      }),
      canonicalLine({
        id: 'italic-plus-bold',
        text: 'Combined',
        font: 'italic',
        baselineY: 655,
        inlineStyles: [{ kind: 'bold', from: 0, to: 8 }],
      }),
      canonicalLine({
        id: 'center',
        text: 'Centered',
        x: 100,
        width: 300,
        align: 'center',
        baselineY: 643,
      }),
      canonicalLine({
        id: 'right',
        text: 'Right',
        x: 100,
        width: 300,
        align: 'right',
        baselineY: 631,
      }),
      canonicalLine({ id: 'empty', text: '', baselineY: 607 }),
    ];

    const bytes = await createScreenplayPdf(modelWithPages('a4', [lines]));
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  it('rejects unsupported glyphs instead of silently replacing screenplay text', async () => {
    await expect(
      createScreenplayPdf(
        modelWithPages('a4', [
          [canonicalLine({ id: 'unsupported', text: 'Unsupported 😀 glyph' })],
        ]),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'ScreenplayPdfUnsupportedGlyphError',
        glyphs: ['😀'],
      }),
    );
  });

  it('downloads an application/pdf Blob and revokes its object URL', async () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe('application/pdf');
      return 'blob:screenplay-pdf';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement');

    await downloadScreenplayPdf(
      'Blue Hour.fountain',
      modelWithPages('letter', [[canonicalLine({})]]),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    const anchor = createElement.mock.results.find(
      (result) => result.value instanceof HTMLAnchorElement,
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('Blue Hour.pdf');
    expect(anchor.href).toBe('blob:screenplay-pdf');
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenplay-pdf');
  });
});

function canonicalLine(overrides: Partial<ScreenplayLayoutLine>): ScreenplayLayoutLine {
  return {
    id: 'line-1',
    blockId: 'block-1',
    kind: 'action',
    text: 'Action.',
    x: 102.75,
    baselineY: 715,
    width: 435,
    columns: 60,
    align: 'left',
    font: 'regular',
    sourceStart: 0,
    sourceEnd: 7,
    ...overrides,
  };
}

function modelWithPages(
  paperSize: ScreenplayPaperSize,
  pages: readonly (readonly ScreenplayLayoutLine[])[],
): ScreenplayPreviewModel {
  return {
    paperSize,
    pages: pages.map((lines, index) => ({
      id: `preview-page-${String(index + 1)}`,
      pageNumber: index + 1,
      blocks: [],
      lines,
    })),
    scenes: [],
    printableBlocks: [],
  };
}
