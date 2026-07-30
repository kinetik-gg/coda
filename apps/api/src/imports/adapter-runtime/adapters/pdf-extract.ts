import { ScreenplayAdapterSourceError, type ScreenplayAdapterContext } from '@coda/contracts';

/**
 * Positioned text extracted from one PDF content stream item. Coordinates are in
 * PDF points with a bottom-left origin, matching `pdfjs-dist`'s text-content
 * transform, which is what lets {@link ../pdf-heuristics} bucket lines by
 * indentation without re-deriving the coordinate system.
 */
export interface PdfExtractedItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfExtractedLine {
  text: string;
  x: number;
  y: number;
}

export interface PdfExtractedPage {
  pageIndex: number;
  pageWidth: number;
  lines: readonly PdfExtractedLine[];
}

export interface PdfExtractionResult {
  pages: readonly PdfExtractedPage[];
  /** Set once cumulative extracted characters crossed {@link PdfExtractionOptions.maxCharacters}. */
  truncated: boolean;
}

export interface PdfExtractionOptions {
  /** Hard ceiling on page count, checked before any page content is read. */
  maxPages: number;
  /**
   * Cumulative extracted-character ceiling, checked after every page. Extraction
   * stops as soon as this is crossed rather than reading the remaining pages, so
   * a hostile document cannot force the whole original into memory: the runtime
   * output-character ceiling is what ultimately rejects the run, but this keeps
   * the peak footprint bounded to roughly one ceiling's worth of text instead of
   * an entire adversarial document.
   */
  maxCharacters: number;
  context: ScreenplayAdapterContext;
}

interface RawTextItem {
  height: number;
  str: string;
  transform: unknown;
  width: number;
}

function isRawTextItem(value: unknown): value is RawTextItem {
  return typeof value === 'object' && value !== null && 'str' in value;
}

/**
 * The small slice of `pdfjs-dist`'s API this module actually calls, declared
 * locally rather than imported from the package's own types. `pdfjs-dist`
 * ships only `.mjs`/`.d.mts` for its Node ("legacy") entry point, which this
 * project's `moduleResolution: "Node"` (classic) `tsconfig` cannot resolve
 * through the package's `exports` map; a local facade sidesteps that entirely
 * and keeps the boundary explicit instead of silently falling back to `any`.
 */
interface PdfPageProxyLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(options: {
    disableNormalization: boolean;
  }): Promise<{ items: readonly unknown[] }>;
  cleanup(): void;
}

interface PdfDocumentProxyLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxyLike>;
}

interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentProxyLike>;
  destroy(): Promise<void>;
}

interface PdfjsLegacyModuleLike {
  getDocument(source: {
    data: Uint8Array;
    disableFontFace: boolean;
    useSystemFonts: boolean;
    isEvalSupported: boolean;
    verbosity: number;
  }): PdfLoadingTaskLike;
}

/**
 * Loads a PDF with `pdfjs-dist`'s legacy Node build and extracts every page's
 * text, page by page, cooperating with the adapter runtime's cancellation
 * signal between pages.
 *
 * No network or filesystem access: `cMapUrl` and `standardFontDataUrl` are
 * deliberately left unset, `disableFontFace`/`useSystemFonts`/`isEvalSupported`
 * are all off, and only the in-memory `data` the caller already holds is ever
 * read. A document whose fonts need an external predefined CMap (some CJK
 * Type0 fonts reference one by name instead of embedding it) fails extraction
 * for that reason rather than reaching out for it; such a document surfaces as
 * `invalid-source`, which is an accepted, documented limitation of a
 * network-and-filesystem-free adapter.
 */
export async function extractPdfPages(
  bytes: Uint8Array,
  options: PdfExtractionOptions,
): Promise<PdfExtractionResult> {
  const pdfjs =
    (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLegacyModuleLike;
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  let document: PdfDocumentProxyLike;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    throw new ScreenplayAdapterSourceError(describeLoadFailure(error));
  }
  try {
    return await readPages(document, options);
  } finally {
    await loadingTask.destroy();
  }
}

async function readPages(
  document: PdfDocumentProxyLike,
  options: PdfExtractionOptions,
): Promise<PdfExtractionResult> {
  const { maxPages, maxCharacters, context } = options;
  if (document.numPages < 1) {
    throw new ScreenplayAdapterSourceError('The PDF has no pages.');
  }
  if (document.numPages > maxPages) {
    throw new ScreenplayAdapterSourceError(
      `The PDF has ${document.numPages} pages, exceeding the ${maxPages}-page limit this adapter supports.`,
    );
  }
  const pages: PdfExtractedPage[] = [];
  let totalCharacters = 0;
  let truncated = false;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    context.throwIfCancelled();
    const pageIndex = pageNumber - 1;
    const page = await readOnePage(document, pageNumber, pageIndex);
    if (page) {
      pages.push(page);
      totalCharacters += page.lines.reduce((sum, line) => sum + line.text.length, 0);
    }
    if (totalCharacters > maxCharacters) {
      truncated = true;
      break;
    }
  }
  return { pages, truncated };
}

async function readOnePage(
  document: PdfDocumentProxyLike,
  pageNumber: number,
  pageIndex: number,
): Promise<PdfExtractedPage | undefined> {
  try {
    const page = await document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false });
      const items = content.items.flatMap((item) =>
        isRawTextItem(item) ? [positionedItem(item)] : [],
      );
      return { pageIndex, pageWidth: viewport.width, lines: groupLines(items) };
    } finally {
      page.cleanup();
    }
  } catch {
    // A single unreadable page (malformed content stream, broken xref entry) does
    // not fail the whole document: it is dropped, and its absence shows up as a
    // smaller extracted document rather than an unattributable crash.
    return { pageIndex, pageWidth: 0, lines: [] };
  }
}

function describeLoadFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') {
    return 'The PDF is password-protected and cannot be converted.';
  }
  if (name === 'InvalidPDFException') {
    return 'The file is not a valid PDF document.';
  }
  return 'The PDF could not be parsed; it may be corrupted or malformed.';
}

function positionedItem(item: RawTextItem): PdfExtractedItem {
  const transform: readonly unknown[] = Array.isArray(item.transform) ? item.transform : [];
  return {
    text: item.str,
    x: finiteNumber(transform[4]),
    y: finiteNumber(transform[5]),
    width: Math.abs(item.width),
    height: Math.abs(item.height || finiteNumber(transform[3]) || finiteNumber(transform[0])),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Groups positioned text items into visual lines by clustering close `y`
 * values, then orders each line left-to-right and joins its items with a space
 * wherever the horizontal gap between them is wider than the narrower item's
 * own average glyph advance — the same rule the PDF export/import parity
 * checker (`apps/web/src/screenplays/screenplay-pdf-parity.ts`) uses to decide
 * where a word boundary belongs, since both consume the same `pdfjs-dist`
 * text-content shape.
 */
function groupLines(items: readonly PdfExtractedItem[]): PdfExtractedLine[] {
  const groups: PdfExtractedItem[][] = [];
  for (const item of [...items].filter(({ text }) => text.length > 0).sort(comparePosition)) {
    const tolerance = Math.max(0.75, item.height * 0.15);
    const group = groups.find(
      (candidate) => Math.abs((candidate[0]?.y ?? 0) - item.y) <= tolerance,
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups
    .sort((first, second) => (second[0]?.y ?? 0) - (first[0]?.y ?? 0))
    .flatMap((group) => {
      const ordered = [...group].sort((first, second) => first.x - second.x);
      const text = reconstructedLineText(ordered);
      return text ? [{ text, x: ordered[0]?.x ?? 0, y: ordered[0]?.y ?? 0 }] : [];
    });
}

function reconstructedLineText(items: readonly PdfExtractedItem[]): string {
  let text = '';
  let previous: PdfExtractedItem | undefined;
  for (const item of items) {
    if (previous && needsInterItemSpace(previous, item, text)) text += ' ';
    text += item.text;
    previous = item;
  }
  return text.replace(/\s+/gu, ' ').trim();
}

function needsInterItemSpace(
  previous: PdfExtractedItem,
  current: PdfExtractedItem,
  accumulatedText: string,
): boolean {
  if (/\s$/u.test(accumulatedText) || /^\s/u.test(current.text)) return false;
  const gap = current.x - (previous.x + previous.width);
  const estimatedAdvance = Math.min(itemAdvance(previous), itemAdvance(current));
  return gap > Math.max(0.5, estimatedAdvance * 0.35);
}

function itemAdvance(item: PdfExtractedItem): number {
  return item.width / Math.max(1, [...item.text].length);
}

function comparePosition(first: PdfExtractedItem, second: PdfExtractedItem): number {
  return second.y - first.y || first.x - second.x;
}
