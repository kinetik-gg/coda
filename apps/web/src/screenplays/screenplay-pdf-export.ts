import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import {
  buildScreenplayPreview,
  type ScreenplayLayoutLine,
  type ScreenplayPreviewBlockKind,
  type ScreenplayPreviewInlineStyle,
  type ScreenplayPreviewModel,
  type ScreenplayPreviewPage,
} from './screenplay-preview-model';
import {
  screenplayPaper,
  type ScreenplayPaperSize,
  type ScreenplayPaperSpecification,
} from './screenplay-paper';
import {
  embedCourierPrimeFonts,
  type ScreenplayPdfFonts,
  type ScreenplayPdfFontStyle,
} from './screenplay-pdf-fonts';

const letterPaper = screenplayPaper('letter');
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
  const model = screenplayModel(input, paperSize);
  const paper = screenplayPaper(model.paperSize);
  return {
    paperSize: model.paperSize,
    pages: model.pages.map((page) => layoutPage(page, paper)),
  };
}

export async function createScreenplayPdf(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
): Promise<Uint8Array> {
  const layout = layoutScreenplayPdf(input, paperSize);
  const paper = screenplayPaper(layout.paperSize);
  const document = await PDFDocument.create();
  document.setCreator('Coda');
  document.setProducer('Coda screenplay PDF exporter');
  document.setCreationDate(new Date('2000-01-01T00:00:00.000Z'));
  document.setModificationDate(new Date('2000-01-01T00:00:00.000Z'));
  const fonts = await embedCourierPrimeFonts(document);

  for (const pageLayout of layout.pages) {
    const page = document.addPage([paper.widthPoints, paper.heightPoints]);
    for (const run of pageLayout.runs) drawStyledRun(page, fonts, run, paper.fontSize);
  }
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: false });
  bytes.set(new TextEncoder().encode('%PDF-1.3'), 0);
  return bytes;
}

export async function createScreenplayPdfBlob(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
): Promise<Blob> {
  const bytes = await createScreenplayPdf(input, paperSize);
  return new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' });
}

export async function downloadScreenplayPdf(
  filename: string,
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize = 'letter',
): Promise<void> {
  const url = URL.createObjectURL(await createScreenplayPdfBlob(input, paperSize));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = canonicalScreenplayPdfFilename(filename);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function screenplayModel(
  input: ScreenplayPdfInput,
  paperSize: ScreenplayPaperSize,
): ScreenplayPreviewModel {
  return typeof input === 'string' ? buildScreenplayPreview(input, { paperSize }) : input;
}

function layoutPage(
  page: ScreenplayPreviewPage,
  paper: ScreenplayPaperSpecification,
): ScreenplayPdfPageLayout {
  const runs = page.lines.flatMap((line) => lineRuns(line, paper));
  if (page.pageNumber !== null && (page.pageNumber > 1 || page.printedPageNumber)) {
    runs.unshift(
      pageNumberRun(`${page.printedPageNumber ?? String(page.pageNumber)}.`, paper),
    );
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

function pageNumberRun(
  text: string,
  paper: ScreenplayPaperSpecification,
): ScreenplayPdfTextRun {
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
    font: 'regular',
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
  return Array.from(text, (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return '?';
    }
  }).join('');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
