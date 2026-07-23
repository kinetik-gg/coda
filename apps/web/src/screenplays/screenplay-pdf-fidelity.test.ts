// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import goldenManifest from './fixtures/pdf-fidelity-manifest.json';
import source from './fixtures/pdf-fidelity.fountain?raw';
import { createScreenplayPdf } from './screenplay-pdf-export';
import {
  comparePdfParityDocuments,
  extractPdfParityDocument,
  type PdfParityDocument,
} from './screenplay-pdf-parity';
import { screenplayPaper } from './screenplay-paper';

const fontDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '../assets/fonts/courier-prime',
);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
      const filename = basename(url.split('?')[0] ?? url);
      return new Response(await readFile(join(fontDirectory, filename)), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screenplay PDF fidelity gate', () => {
  it('matches the locked golden page, line, text, and coordinate manifest', async () => {
    const bytes = await createScreenplayPdf(source, 'letter');
    const candidate = await extractPdfParityDocument(bytes);
    const report = comparePdfParityDocuments(candidate, parityDocument(goldenManifest), {
      pageSizeTolerancePoints: 0.01,
      coordinateTolerancePoints: 0.01,
    });

    expect(report).toMatchObject({
      passed: true,
      pageCount: { candidate: 3, reference: 3, exact: true },
      pageSize: { mismatchedPages: 0 },
      text: { exact: true, similarity: 1 },
      lineBreaks: { exact: true, similarity: 1 },
      coordinates: { pageMismatchedTokens: 0, withinToleranceShare: 1 },
    });
  });

  it('documents the golden anchors derived from canonical letter geometry', () => {
    const paper = screenplayPaper('letter');
    const golden = parityDocument(goldenManifest);
    const title = golden.pages[0]!.lines;
    const firstBody = golden.pages[1]!.lines;
    const secondBody = golden.pages[2]!.lines;
    const topFieldWidth = paper.widthPoints - 80;
    const topFieldX = 42.5;
    const centeredX = (text: string) =>
      topFieldX + (topFieldWidth - text.length * paper.fontAdvance) / 2;

    expect(golden.pages.map(({ width, height }) => ({ width, height }))).toEqual(
      Array.from({ length: 3 }, () => ({
        width: paper.widthPoints,
        height: paper.heightPoints,
      })),
    );
    expect(title.map(({ text, y }) => ({ text, y }))).toEqual([
      { text: 'THE QUIET ORBIT', y: paper.heightPoints - 290.5 },
      { text: 'Written by', y: paper.heightPoints - 338.5 },
      { text: 'Avery Stone', y: paper.heightPoints - 362.5 },
      { text: 'July 23, 2026', y: 88.5 },
    ]);
    expect(title[0]!.tokens[0]!.x).toBe(centeredX(title[0]!.text));
    expect(title[1]!.tokens[0]!.x).toBe(centeredX(title[1]!.text));
    expect(title[2]!.tokens[0]!.x).toBe(centeredX(title[2]!.text));

    expect(firstBody.map(({ text }) => text)).toEqual([
      '1 INT. OBSERVATORY - NIGHT 1',
      'A brass telescope tracks the moon while rain sketches silver',
      'lines across the glass.',
      'MIRA JONAH',
      '(softly) I have it.',
      'Hold the light steady.',
      'MIRA',
      'Then mark the time.',
    ]);
    expect(firstBody[0]!.tokens[0]!.x).toBe(paper.sceneNumberLeft);
    expect(firstBody[0]!.tokens[1]!.x).toBe(paper.leftMargin + 0.75);
    expect(firstBody[0]!.tokens.at(-1)!.x).toBe(paper.sceneNumberRight - paper.fontAdvance);
    expect(firstBody[0]!.y).toBe(paper.firstBodyBaseline);
    expect(firstBody[1]!.tokens[0]!.x).toBe(paper.leftMargin);
    expect(firstBody[1]!.y).toBe(paper.firstBodyBaseline - 2 * paper.lineHeight);
    expect(firstBody[3]!.tokens.map(({ x }) => x)).toEqual([
      paper.bodyFrameLeft + 7 * paper.glyphWidth,
      paper.bodyFrameLeft + 37 * paper.glyphWidth,
    ]);
    expect(firstBody[4]!.tokens[0]!.x).toBe(paper.bodyFrameLeft + 4 * paper.glyphWidth);
    expect(firstBody[4]!.tokens[3]!.x).toBe(paper.bodyFrameLeft + 30 * paper.glyphWidth);
    expect(firstBody[5]!.tokens[0]!.x).toBe(paper.bodyFrameLeft);
    expect(firstBody[6]!.tokens[0]!.x).toBe(paper.leftMargin + 19 * paper.glyphWidth);
    expect(firstBody[7]!.tokens[0]!.x).toBe(paper.leftMargin + 10 * paper.glyphWidth);

    expect(secondBody.map(({ text }) => text)).toEqual([
      '2.',
      '2 EXT. COURTYARD - DAWN 2',
      'The clouds open above the empty fountain.',
    ]);
    expect(secondBody[0]!.tokens[0]!.x).toBe(paper.pageNumberRight - 2 * paper.fontAdvance);
    expect(secondBody[0]!.y).toBe(paper.pageNumberBaseline);
    expect(secondBody[1]!.y).toBe(paper.subsequentBodyBaseline);
  });

  it('rejects isolated page count, size, line break, text, and coordinate drift', () => {
    const reference = parityDocument(goldenManifest);
    const reports = [
      comparePdfParityDocuments(withPageCountDrift(reference), reference),
      comparePdfParityDocuments(withPageSizeDrift(reference), reference),
      comparePdfParityDocuments(withLineBreakDrift(reference), reference),
      comparePdfParityDocuments(withTextDrift(reference), reference),
      comparePdfParityDocuments(withCoordinateDrift(reference), reference),
    ];

    expect(reports.map(({ passed }) => passed)).toEqual([false, false, false, false, false]);
    expect(reports[0]?.pageCount.exact).toBe(false);
    expect(reports[1]?.pageSize.mismatchedPages).toBe(1);
    expect(reports[2]?.lineBreaks.exact).toBe(false);
    expect(reports[3]?.text.exact).toBe(false);
    expect(reports[4]?.coordinates.withinToleranceShare).toBeLessThan(1);
  });
});

interface GoldenToken {
  text: string;
  x: number;
}

interface GoldenLine {
  text: string;
  y: number;
  tokens: readonly GoldenToken[];
}

interface GoldenPage {
  width: number;
  height: number;
  lines: readonly GoldenLine[];
}

function parityDocument(manifest: { pages: readonly GoldenPage[] }): PdfParityDocument {
  return {
    pages: manifest.pages.map((page) => ({
      width: page.width,
      height: page.height,
      lines: page.lines.map((line) => ({
        text: line.text,
        x: line.tokens[0]?.x ?? 0,
        y: line.y,
        tokens: line.tokens.map((token) => ({
          ...token,
          y: line.y,
          width: 0,
          height: 0,
        })),
      })),
    })),
  };
}

function replacePage(
  document: PdfParityDocument,
  index: number,
  page: PdfParityDocument['pages'][number],
): PdfParityDocument {
  return {
    pages: document.pages.map((current, pageIndex) => (pageIndex === index ? page : current)),
  };
}

function withPageCountDrift(document: PdfParityDocument): PdfParityDocument {
  return { pages: document.pages.slice(0, -1) };
}

function withPageSizeDrift(document: PdfParityDocument): PdfParityDocument {
  const page = document.pages[0]!;
  return replacePage(document, 0, { ...page, width: page.width + 1 });
}

function withLineBreakDrift(document: PdfParityDocument): PdfParityDocument {
  const page = document.pages[1]!;
  const line = page.lines[1]!;
  const split = 4;
  const lines = [
    page.lines[0]!,
    { ...line, text: 'A brass telescope tracks the moon', tokens: line.tokens.slice(0, split) },
    {
      ...line,
      text: 'while rain sketches silver',
      y: line.y - 12,
      tokens: line.tokens.slice(split).map((token) => ({ ...token, y: token.y - 12 })),
    },
    ...page.lines.slice(2),
  ];
  return replacePage(document, 1, { ...page, lines });
}

function withTextDrift(document: PdfParityDocument): PdfParityDocument {
  const page = document.pages[2]!;
  const line = page.lines[2]!;
  const lines = page.lines.map((current, index) =>
    index === 2
      ? {
          ...line,
          text: 'The clouds close above the empty fountain.',
          tokens: line.tokens.map((token, tokenIndex) =>
            tokenIndex === 1 ? { ...token, text: 'close' } : token,
          ),
        }
      : current,
  );
  return replacePage(document, 2, { ...page, lines });
}

function withCoordinateDrift(document: PdfParityDocument): PdfParityDocument {
  const page = document.pages[0]!;
  const line = page.lines[0]!;
  const tokens = line.tokens.map((token, index) =>
    index === 0 ? { ...token, x: token.x + 2 } : token,
  );
  const lines = page.lines.map((current, index) =>
    index === 0 ? { ...line, x: line.x + 2, tokens } : current,
  );
  return replacePage(document, 0, { ...page, lines });
}
