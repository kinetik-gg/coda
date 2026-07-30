import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Builds small, realistic screenplay-formatted PDFs for the PDF adapter's own
 * tests, using the standard US screenplay indentation columns (action/scene
 * heading at the left margin, dialogue and parenthetical stepped in, character
 * cues further right) on a Letter page. Test-only: `pdf-lib`'s `StandardFonts`
 * are built into the package itself, so building these fixtures never reaches
 * the network either.
 */
export interface PdfFixtureLine {
  kind: 'scene_heading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';
  text: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT_MARGIN = 108;
const DIALOGUE_X = 180;
const PARENTHETICAL_X = 200;
const CHARACTER_X = 266;
const TRANSITION_X = 400;
const LINE_HEIGHT = 14;
const FONT_SIZE = 12;

function xFor(kind: PdfFixtureLine['kind']): number {
  switch (kind) {
    case 'dialogue':
      return DIALOGUE_X;
    case 'parenthetical':
      return PARENTHETICAL_X;
    case 'character':
      return CHARACTER_X;
    case 'transition':
      return TRANSITION_X;
    case 'action':
    case 'scene_heading':
      return LEFT_MARGIN;
  }
}

export async function buildScreenplayPdf(
  pages: readonly (readonly PdfFixtureLine[])[],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Courier);
  for (const lines of pages) {
    drawPage(document, font, lines);
  }
  return document.save();
}

function drawPage(document: PDFDocument, font: PDFFont, lines: readonly PdfFixtureLine[]): void {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - 72;
  for (const line of lines) {
    if (line.text === '') {
      y -= LINE_HEIGHT;
      continue;
    }
    drawLine(page, font, line, y);
    y -= LINE_HEIGHT;
  }
}

function drawLine(page: PDFPage, font: PDFFont, line: PdfFixtureLine, y: number): void {
  page.drawText(line.text, { x: xFor(line.kind), y, size: FONT_SIZE, font });
}

/** A single blank line, used between fixture blocks to mirror real paragraph spacing. */
export const BLANK: PdfFixtureLine = { kind: 'action', text: '' };
