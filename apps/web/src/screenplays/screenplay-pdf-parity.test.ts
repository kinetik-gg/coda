import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPdfParityDocument, verifyPdfParity } from './screenplay-pdf-parity';

describe('screenplay PDF parity', () => {
  it('reports page, line, text, and coordinate mismatches without exposing document text', async () => {
    const candidate = await fixturePdf({
      xShift: 12,
      secondLine: 'Changed line.',
      extraPage: true,
    });
    const reference = await fixturePdf();
    const report = await verifyPdfParity(candidate, reference);

    expect(report.passed).toBe(false);
    expect(report.pageCount).toEqual({ candidate: 3, reference: 2, exact: false });
    expect(report.text.exact).toBe(false);
    expect(report.text.similarity).toBeLessThan(1);
    expect(report.lineBreaks.exact).toBe(false);
    expect(report.coordinates.meanAbsoluteXDelta).toBeGreaterThan(10);
    expect(report.coordinates.withinToleranceShare).toBe(0);
    expect(JSON.stringify(report)).not.toContain('Changed line');
  });

  it('reconstructs adjacent styled runs without inserting synthetic spaces', async () => {
    const candidate = await styledRunPdf(true);
    const reference = await styledRunPdf(false);
    const extracted = await extractPdfParityDocument(candidate);
    const report = await verifyPdfParity(candidate, reference);

    expect(extracted.pages[0]?.lines[0]?.text).toBe('tempat yang indah.');
    expect(report).toMatchObject({
      passed: true,
      text: { exact: true },
      lineBreaks: { exact: true },
      coordinates: { withinToleranceShare: 1 },
    });
  });
});

async function styledRunPdf(segmented: boolean): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Courier);
  const bold = await document.embedFont(StandardFonts.CourierBold);
  const page = document.addPage([612, 792]);
  const size = 12;
  const x = 72;
  const y = 720;
  if (!segmented) {
    page.drawText('tempat yang indah.', { x, y, size, font: regular });
    return document.save();
  }
  const prefix = 'tempat yang ';
  const emphasized = 'indah';
  const emphasizedX = x + regular.widthOfTextAtSize(prefix, size);
  const punctuationX = emphasizedX + bold.widthOfTextAtSize(emphasized, size);
  page.drawText(prefix, { x, y, size, font: regular });
  page.drawText(emphasized, { x: emphasizedX, y, size, font: bold });
  page.drawText('.', { x: punctuationX, y, size, font: regular });
  return document.save();
}

async function fixturePdf(
  options: { xShift?: number; secondLine?: string; extraPage?: boolean } = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Courier);
  const first = document.addPage([612, 792]);
  const x = 72 + (options.xShift ?? 0);
  first.drawText('INT. TEST ROOM - DAY', { x, y: 720, size: 12, font });
  first.drawText(options.secondLine ?? 'Synthetic action.', { x, y: 696, size: 12, font });
  const second = document.addPage([612, 792]);
  second.drawText('2.', { x: 520 + (options.xShift ?? 0), y: 756, size: 12, font });
  second.drawText('TESTER', { x: 252 + (options.xShift ?? 0), y: 700, size: 12, font });
  second.drawText('Synthetic dialogue.', {
    x: 180 + (options.xShift ?? 0),
    y: 676,
    size: 12,
    font,
  });
  if (options.extraPage) document.addPage([595, 842]);
  return document.save();
}
