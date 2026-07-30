import {
  ScreenplayAdapterSourceError,
  type ScreenplayAdapter,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterInput,
  type ScreenplayAdapterOutput,
  type ScreenplayConversionElement,
} from '@coda/contracts';
import { parseFountain, type FountainElement } from '@coda/fountain';
import { extractPdfPages } from './pdf-extract';
import { classifyPdfPages, renderPdfBlock, type PdfBlock } from './pdf-heuristics';

/** The source-format slug this adapter answers for. */
export const PDF_SOURCE_FORMAT = 'pdf';

/**
 * A defensive ceiling on page count, independent of the runtime's byte-size and
 * output-character limits. It exists because a hostile PDF's page *count* can be
 * cheap to claim (a corrupted or adversarial page tree) yet expensive to walk —
 * this rejects before any page's content stream is ever decoded. 2,000 pages
 * mirrors the ceiling the screenplay PDF *exporter* already enforces
 * (`SCREENPLAY_PDF_EXPORT_LIMITS.pages` in
 * `apps/web/src/screenplays/screenplay-pdf-export.ts`), well beyond any real
 * feature-length screenplay.
 */
const MAX_PDF_PAGES = 2_000;

/**
 * Text-based PDF import. Reuses `pdfjs-dist` — already an audited, in-repo
 * dependency of `apps/web` for both PDF export and PDF/Fountain parity
 * checking — for text-layer extraction only. There is no OCR path: a PDF with
 * no meaningful extracted text (a scanned or image-only document) is rejected
 * with an explicit, attributable message rather than silently producing an
 * empty screenplay or reaching for image recognition, which the adapter
 * runtime's no-network, no-filesystem contract forbids outright.
 *
 * Extraction happens page by page (`pdf-extract.ts`) and cooperates with the
 * runtime's soft deadline between pages. Line classification
 * (`pdf-heuristics.ts`) buckets each extracted line into a Fountain construct
 * by content pattern first and page-relative indentation second; blocks
 * inferred from indentation alone are reported `uncertain` rather than
 * `converted`, which is how this adapter surfaces classification ambiguity
 * from multi-column layouts, unusual margins, or noisy headers instead of
 * silently guessing.
 */
class PdfAdapter implements ScreenplayAdapter {
  readonly id = 'coda.pdf';
  readonly version = '1';
  readonly sourceFormats = [PDF_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    context.throwIfCancelled();
    const extraction = await extractPdfPages(input.bytes, {
      maxPages: MAX_PDF_PAGES,
      maxCharacters: context.limits.maxOutputCharacters,
      context,
    });
    context.throwIfCancelled();
    context.reportProgress({
      stage: 'extracted',
      completed: extraction.pages.length,
      total: extraction.pages.length,
    });

    const blocks = classifyPdfPages(extraction.pages);
    assertHasText(blocks);
    const { fountain, ranges } = renderFountain(blocks);
    context.throwIfCancelled();

    const parsed = parseFountain(fountain);
    const elements = parsed.elements.map((element) => toReportElement(element, ranges));
    return { convertedFountain: fountain, elements, warnings: [] };
  }
}

interface BlockRange {
  pageIndex: number;
  confidence: 'certain' | 'uncertain';
  start: number;
  end: number;
}

function renderFountain(blocks: readonly PdfBlock[]): { fountain: string; ranges: BlockRange[] } {
  let fountain = '';
  const ranges: BlockRange[] = [];
  for (const block of blocks) {
    const text = renderPdfBlock(block);
    if (text === '') continue;
    if (fountain !== '') fountain += '\n\n';
    const start = fountain.length;
    fountain += text;
    ranges.push({
      pageIndex: block.pageIndex,
      confidence: block.confidence,
      start,
      end: fountain.length,
    });
  }
  return { fountain, ranges };
}

function assertHasText(blocks: readonly PdfBlock[]): void {
  const hasText = blocks.some((block) => block.lines.some((line) => line.trim().length > 0));
  if (!hasText) {
    throw new ScreenplayAdapterSourceError(
      'This PDF has no extractable text layer. It appears to be a scanned or ' +
        'image-only document; optical character recognition is not supported, so ' +
        're-export the screenplay with embedded text before importing it.',
    );
  }
}

function toReportElement(
  element: FountainElement,
  ranges: readonly BlockRange[],
): ScreenplayConversionElement {
  const range = ranges.find(
    (candidate) => element.start >= candidate.start && element.start < candidate.end,
  );
  const pageIndex = range?.pageIndex ?? 0;
  const uncertain = range?.confidence === 'uncertain';
  const kindLabel = element.kind.replace('_', ' ');
  return {
    id: `pdf-${pageIndex + 1}-${element.start}`,
    status: uncertain ? 'uncertain' : 'converted',
    source: {
      kind: 'pdf-page',
      location: { unit: 'page', start: pageIndex, end: pageIndex + 1 },
    },
    target: {
      kind: element.kind,
      location: { unit: 'character', start: element.start, end: element.end },
    },
    summary: uncertain
      ? `Layout heuristics inferred a ${kindLabel} from indentation alone on page ${pageIndex + 1}; verify this classification.`
      : `Converted a PDF block to Fountain ${kindLabel} (page ${pageIndex + 1}).`,
    warnings: uncertain
      ? [
          {
            code: 'PDF_LAYOUT_AMBIGUOUS',
            message: `Page ${pageIndex + 1}: classified as ${kindLabel} from indentation alone, not an unambiguous textual pattern.`,
          },
        ]
      : [],
  };
}

export function createPdfAdapter(): ScreenplayAdapter {
  return new PdfAdapter();
}
