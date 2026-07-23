import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import {
  buildScreenplayPreview,
  type ScreenplayLayoutLine,
  type ScreenplayPreviewBlockKind,
  type ScreenplayPreviewInlineStyle,
  type ScreenplayPreviewModel,
  type ScreenplayPreviewPage,
} from './screenplay-preview-model';
import type { ScreenplayPaginationObserver } from './screenplay-layout-engine';
import {
  screenplayPaper,
  type ScreenplayPaperSize,
  type ScreenplayPaperSpecification,
} from './screenplay-paper';
import {
  courierPrimeUnsupportedGraphemes,
  embedCourierPrimeFonts,
  type ScreenplayPdfFonts,
  type ScreenplayPdfFontStyle,
} from './screenplay-pdf-fonts';
import { screenplayGraphemes } from './screenplay-graphemes';

const letterPaper = screenplayPaper('letter');
const PDF_RENDER_YIELD_INTERVAL = 1_024;
const MAX_REPORTED_UNSUPPORTED_GLYPHS = 32;
export const SCREENPLAY_PDF_EXPORT_LIMITS = Object.freeze({
  sourceCodeUnits: 1_000_000,
  pages: 2_000,
  runs: 100_000,
  textCodeUnits: 5_000_000,
});
export const SCREENPLAY_PDF_PAGE = Object.freeze({
  width: letterPaper.widthPoints,
  height: letterPaper.heightPoints,
  bodyTop: letterPaper.bodyTop,
  bodyBottom: letterPaper.bodyBottom,
  left: letterPaper.leftMargin,
  right: letterPaper.rightEdge,
  lineHeight: letterPaper.lineHeight,
  fontSize: letterPaper.fontSize,
});

export type ScreenplayPdfRunRole =
  ScreenplayPreviewBlockKind | 'page-number' | 'revision-mark' | 'scene-number' | 'title-field';

export interface ScreenplayPdfTextRun {
  text: string;
  x: number;
  y: number;
  align?: 'center' | 'left' | 'right';
  width?: number;
  role: ScreenplayPdfRunRole;
  font: ScreenplayPdfFontStyle;
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
  underline?: boolean;
}

export interface ScreenplayPdfPageLayout {
  kind: 'body' | 'title';
  pageNumber: number | null;
  runs: readonly ScreenplayPdfTextRun[];
}

export interface ScreenplayPdfLayout {
  paperSize: ScreenplayPaperSize;
  pages: readonly ScreenplayPdfPageLayout[];
}

export type ScreenplayPdfInput = ScreenplayPreviewModel | string;

export interface ScreenplayPdfExportOptions {
  signal?: AbortSignal;
}

export class ScreenplayPdfExportLimitError extends Error {
  readonly dimension: 'pages' | 'runs' | 'source-code-units' | 'text-code-units';
  readonly actual: number;
  readonly limit: number;

  constructor(
    dimension: ScreenplayPdfExportLimitError['dimension'],
    actual: number,
    limit: number,
  ) {
    const label = dimension.replaceAll('-', ' ');
    super(
      `PDF export has ${actual.toLocaleString('en-US')} ${label}; the browser safety limit is ${limit.toLocaleString('en-US')}. Split the screenplay into smaller documents before exporting.`,
    );
    this.name = 'ScreenplayPdfExportLimitError';
    this.dimension = dimension;
    this.actual = actual;
    this.limit = limit;
  }
}

export class ScreenplayPdfUnsupportedGlyphError extends Error {
  readonly glyphs: readonly string[];
  readonly truncated: boolean;

  constructor(glyphs: readonly string[], truncated = false) {
    const labels = glyphs.map(
      (glyph) =>
        `${glyph} (${Array.from(
          glyph,
          (character) =>
            `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`,
        ).join(' ')})`,
    );
    const omitted = truncated ? ' Additional unsupported glyphs were omitted.' : '';
    super(
      `PDF export cannot render ${labels.join(', ')} with the embedded screenplay font.${omitted}`,
    );
    this.name = 'ScreenplayPdfUnsupportedGlyphError';
    this.glyphs = glyphs;
    this.truncated = truncated;
  }
}

export function canonicalScreenplayPdfFilename(filename: string): string {
  const stem = filename.replace(/\.(?:fountain|spmd|txt|pdf)$/iu, '').trim();
  return `${stem || 'screenplay'}.pdf`;
}

/**
 * Adapts the canonical point-based layout to PDF drawing commands. No text is
 * wrapped or paginated here: preview and export consume the same laid-out lines.
 */
export function layoutScreenplayPdf(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
): ScreenplayPdfLayout {
  const model = boundedScreenplayModel(input, paperSize);
  const paper = screenplayPaper(model.paperSize);
  return {
    paperSize: model.paperSize,
    pages: model.pages.map((page) => layoutPage(page, paper)),
  };
}

export async function createScreenplayPdf(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
  options: ScreenplayPdfExportOptions = {},
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const layout = layoutScreenplayPdf(input, paperSize);
  options.signal?.throwIfAborted();
  assertPdfLayoutWithinLimits(layout);
  await assertGlyphCoverage(layout, options.signal);
  const paper = screenplayPaper(layout.paperSize);
  const document = await PDFDocument.create();
  document.setCreator('Coda');
  document.setProducer('Coda screenplay PDF exporter');
  document.setCreationDate(new Date('2000-01-01T00:00:00.000Z'));
  document.setModificationDate(new Date('2000-01-01T00:00:00.000Z'));
  const fonts = await embedCourierPrimeFonts(document);

  let renderedRuns = 0;
  for (const pageLayout of layout.pages) {
    options.signal?.throwIfAborted();
    const page = document.addPage([paper.widthPoints, paper.heightPoints]);
    for (const run of pageLayout.runs) {
      drawStyledRun(page, fonts, run, paper.fontSize);
      renderedRuns += 1;
      if (renderedRuns % PDF_RENDER_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
        options.signal?.throwIfAborted();
      }
    }
  }
  options.signal?.throwIfAborted();
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: false });
  bytes.set(new TextEncoder().encode('%PDF-1.3'), 0);
  return bytes;
}

async function assertGlyphCoverage(
  layout: ScreenplayPdfLayout,
  signal?: AbortSignal,
): Promise<void> {
  const graphemes = new Set<string>();
  let scannedRuns = 0;
  for (const page of layout.pages) {
    for (const run of page.runs) {
      for (const grapheme of screenplayGraphemes(run.text)) graphemes.add(grapheme.text);
      scannedRuns += 1;
      if (scannedRuns % PDF_RENDER_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
    }
  }
  const unsupported = await courierPrimeUnsupportedGraphemes([...graphemes], {
    maximumResults: MAX_REPORTED_UNSUPPORTED_GLYPHS + 1,
    signal,
  });
  if (unsupported.length === 0) return;
  const truncated = unsupported.length > MAX_REPORTED_UNSUPPORTED_GLYPHS;
  throw new ScreenplayPdfUnsupportedGlyphError(
    unsupported.slice(0, MAX_REPORTED_UNSUPPORTED_GLYPHS),
    truncated,
  );
}

export async function createScreenplayPdfBlob(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
  options: ScreenplayPdfExportOptions = {},
): Promise<Blob> {
  const bytes = await createScreenplayPdf(input, paperSize, options);
  return new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' });
}

export async function downloadScreenplayPdf(
  filename: string,
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
  options: ScreenplayPdfExportOptions = {},
): Promise<void> {
  const url = URL.createObjectURL(await createScreenplayPdfBlob(input, paperSize, options));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = canonicalScreenplayPdfFilename(filename);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function assertPreviewModelWithinLimits(model: ScreenplayPreviewModel): void {
  if (model.pages.length > SCREENPLAY_PDF_EXPORT_LIMITS.pages) {
    throw new ScreenplayPdfExportLimitError(
      'pages',
      model.pages.length,
      SCREENPLAY_PDF_EXPORT_LIMITS.pages,
    );
  }
  let runs = 0;
  let textCodeUnits = 0;
  for (const page of model.pages) {
    if (page.pageNumber !== null && (page.pageNumber > 1 || page.printedPageNumber)) {
      runs += 1;
      textCodeUnits += `${page.printedPageNumber ?? String(page.pageNumber)}.`.length;
    }
    for (const line of page.lines) {
      runs += 1 + (line.sceneNumber ? 2 : 0) + (line.revisionMarker ? 1 : 0);
      textCodeUnits +=
        line.text.length + (line.sceneNumber?.length ?? 0) * 2 + (line.revisionMarker?.length ?? 0);
      assertPdfWorkCounts(runs, textCodeUnits);
    }
    assertPdfWorkCounts(runs, textCodeUnits);
  }
}

function assertPdfLayoutWithinLimits(layout: ScreenplayPdfLayout): void {
  if (layout.pages.length > SCREENPLAY_PDF_EXPORT_LIMITS.pages) {
    throw new ScreenplayPdfExportLimitError(
      'pages',
      layout.pages.length,
      SCREENPLAY_PDF_EXPORT_LIMITS.pages,
    );
  }
  let runs = 0;
  let textCodeUnits = 0;
  for (const page of layout.pages) {
    runs += page.runs.length;
    for (const run of page.runs) {
      textCodeUnits += run.text.length;
    }
    assertPdfWorkCounts(runs, textCodeUnits);
  }
}

function assertPdfWorkCounts(runs: number, textCodeUnits: number): void {
  if (runs > SCREENPLAY_PDF_EXPORT_LIMITS.runs) {
    throw new ScreenplayPdfExportLimitError('runs', runs, SCREENPLAY_PDF_EXPORT_LIMITS.runs);
  }
  if (textCodeUnits > SCREENPLAY_PDF_EXPORT_LIMITS.textCodeUnits) {
    throw new ScreenplayPdfExportLimitError(
      'text-code-units',
      textCodeUnits,
      SCREENPLAY_PDF_EXPORT_LIMITS.textCodeUnits,
    );
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function boundedScreenplayModel(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize,
): ScreenplayPreviewModel {
  if (typeof input !== 'string') {
    assertPreviewModelWithinLimits(input);
    return input;
  }
  if (input.length > SCREENPLAY_PDF_EXPORT_LIMITS.sourceCodeUnits) {
    throw new ScreenplayPdfExportLimitError(
      'source-code-units',
      input.length,
      SCREENPLAY_PDF_EXPORT_LIMITS.sourceCodeUnits,
    );
  }
  assertForcedBreakOnlyPageBudget(input);
  const model = buildScreenplayPreview(input, { paperSize }, pdfPreviewPaginationObserver());
  assertPreviewModelWithinLimits(model);
  return model;
}

function assertForcedBreakOnlyPageBudget(source: string): void {
  const pages = forcedBreakOnlyPageCount(source);
  if (pages === undefined || pages <= SCREENPLAY_PDF_EXPORT_LIMITS.pages) return;
  throw new ScreenplayPdfExportLimitError('pages', pages, SCREENPLAY_PDF_EXPORT_LIMITS.pages);
}

/**
 * A document made only from explicit page breaks has an exact page count that
 * can be established in constant space before the Fountain parser allocates a
 * source-line, semantic-token, or preview-page entry for every break.
 */
function forcedBreakOnlyPageCount(source: string): number | undefined {
  let start = 0;
  let lineIndex = 0;
  let pageBreaks = 0;
  while (start < source.length) {
    const newline = source.indexOf('\n', start);
    const contentEnd =
      newline < 0
        ? source.length
        : newline > start && source[newline - 1] === '\r'
          ? newline - 1
          : newline;
    let text = source.slice(start, contentEnd);
    if (lineIndex === 0 && text.startsWith('\uFEFF')) text = text.slice(1);
    const trimmed = text.trim();
    if (trimmed && !/^={3,}$/u.test(trimmed)) return undefined;
    if (trimmed) pageBreaks += 1;
    if (newline < 0) break;
    start = newline + 1;
    lineIndex += 1;
  }
  return pageBreaks ? pageBreaks + 1 : undefined;
}

function pdfPreviewPaginationObserver(): ScreenplayPaginationObserver {
  let pages = 0;
  let runs = 0;
  let textCodeUnits = 0;
  return {
    beforeLine(line) {
      runs += 1 + (line.sceneNumber ? 2 : 0) + (line.revisionMarker ? 1 : 0);
      textCodeUnits +=
        line.text.length + (line.sceneNumber?.length ?? 0) * 2 + (line.revisionMarker?.length ?? 0);
      assertPdfWorkCounts(runs, textCodeUnits);
    },
    beforePage(pageNumber) {
      pages += 1;
      if (pages > SCREENPLAY_PDF_EXPORT_LIMITS.pages) {
        throw new ScreenplayPdfExportLimitError('pages', pages, SCREENPLAY_PDF_EXPORT_LIMITS.pages);
      }
      if (pageNumber > 1) {
        const pageNumberText = `${String(pageNumber)}.`;
        runs += 1;
        textCodeUnits += pageNumberText.length;
        assertPdfWorkCounts(runs, textCodeUnits);
      }
    },
  };
}

function layoutPage(
  page: ScreenplayPreviewPage,
  paper: ScreenplayPaperSpecification,
): ScreenplayPdfPageLayout {
  const runs = page.lines.flatMap((line) => lineRuns(line, paper));
  if (page.pageNumber !== null && (page.pageNumber > 1 || page.printedPageNumber)) {
    runs.unshift(pageNumberRun(`${page.printedPageNumber ?? String(page.pageNumber)}.`, paper));
  }
  return {
    kind: page.pageNumber === null ? 'title' : 'body',
    pageNumber: page.pageNumber,
    runs,
  };
}

function lineRuns(
  line: ScreenplayLayoutLine,
  paper: ScreenplayPaperSpecification,
): ScreenplayPdfTextRun[] {
  const runs: ScreenplayPdfTextRun[] = [
    {
      text: line.text,
      x: line.x,
      y: line.baselineY,
      align: line.align,
      width: line.width,
      role: line.kind === 'title-page' ? 'title-field' : line.kind,
      font: line.font,
      inlineStyles: line.inlineStyles,
    },
  ];
  if (line.sceneNumber) {
    runs.unshift(sceneNumberRun(line.sceneNumber, line.baselineY, 'left', paper));
    runs.push(sceneNumberRun(line.sceneNumber, line.baselineY, 'right', paper));
  }
  if (line.revisionMarker) {
    runs.push({
      text: line.revisionMarker,
      x: paper.revisionMarkLeft,
      y: line.baselineY,
      role: 'revision-mark',
      font: 'regular',
    });
  }
  return runs;
}

function pageNumberRun(text: string, paper: ScreenplayPaperSpecification): ScreenplayPdfTextRun {
  return {
    text,
    x: paper.pageNumberRight,
    y: paper.pageNumberBaseline,
    align: 'right',
    role: 'page-number',
    font: 'regular',
  };
}

function sceneNumberRun(
  sceneNumber: string,
  y: number,
  side: 'left' | 'right',
  paper: ScreenplayPaperSpecification,
): ScreenplayPdfTextRun {
  return {
    text: sceneNumber,
    x: side === 'left' ? paper.sceneNumberLeft : paper.sceneNumberRight,
    y,
    align: side,
    role: 'scene-number',
    font: 'bold',
  };
}

interface StyledSegment {
  text: string;
  font: ScreenplayPdfFontStyle;
  underline: boolean;
}

function drawStyledRun(
  page: PDFPage,
  fonts: ScreenplayPdfFonts,
  run: ScreenplayPdfTextRun,
  fontSize: number,
): void {
  const segments = styledSegments(run).map((segment) => {
    const font = fonts[segment.font];
    const text = fontSafeText(font, segment.text);
    return { ...segment, font, text, width: font.widthOfTextAtSize(text, fontSize) };
  });
  const textWidth = segments.reduce((total, segment) => total + segment.width, 0);
  let x = alignedX(run, textWidth);
  for (const segment of segments) {
    if (!segment.text) continue;
    const { font, text, width } = segment;
    page.drawText(text, { x, y: run.y, size: fontSize, font, color: rgb(0, 0, 0) });
    if (segment.underline) drawUnderline(page, x, run.y, width);
    x += width;
  }
}

function alignedX(run: ScreenplayPdfTextRun, textWidth: number): number {
  if (run.align === 'right') return run.x + (run.width ?? 0) - textWidth;
  if (run.align === 'center') return run.x + ((run.width ?? 0) - textWidth) / 2;
  return run.x;
}

function styledSegments(run: ScreenplayPdfTextRun): StyledSegment[] {
  const styles = run.inlineStyles ?? [];
  const boundaries = new Set([0, run.text.length]);
  for (const style of styles) {
    boundaries.add(clamp(style.from, 0, run.text.length));
    boundaries.add(clamp(style.to, 0, run.text.length));
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.slice(0, -1).flatMap((from, index) => {
    const to = ordered[index + 1] ?? from;
    if (to <= from) return [];
    const active = styles.filter((style) => style.from < to && style.to > from);
    return [
      {
        text: run.text.slice(from, to),
        font: combinedFontStyle(run.font, active),
        underline: Boolean(run.underline) || active.some((style) => style.kind === 'underline'),
      },
    ];
  });
}

function combinedFontStyle(
  base: ScreenplayPdfFontStyle,
  styles: readonly ScreenplayPreviewInlineStyle[],
): ScreenplayPdfFontStyle {
  const bold =
    base === 'bold' ||
    base === 'bold-italic' ||
    styles.some((style) => style.kind === 'bold' || style.kind === 'bold_italic');
  const italic =
    base === 'italic' ||
    base === 'bold-italic' ||
    styles.some((style) => style.kind === 'italic' || style.kind === 'bold_italic');
  if (bold && italic) return 'bold-italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

function drawUnderline(page: PDFPage, x: number, y: number, width: number): void {
  page.drawLine({
    start: { x, y: y - 1.5 },
    end: { x: x + width, y: y - 1.5 },
    thickness: 0.7,
    color: rgb(0, 0, 0),
  });
}

function fontSafeText(font: PDFFont, text: string): string {
  font.encodeText(text);
  return text;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
