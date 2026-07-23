import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { verifyPdfParity } from './screenplay-pdf-parity';

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
});

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
