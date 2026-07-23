import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export interface PdfParityToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfParityLine {
  text: string;
  x: number;
  y: number;
  tokens: readonly PdfParityToken[];
}

export interface PdfParityPage {
  width: number;
  height: number;
  lines: readonly PdfParityLine[];
}

export interface PdfParityDocument {
  pages: readonly PdfParityPage[];
}

export interface PdfParityOptions {
  pageSizeTolerancePoints?: number;
  coordinateTolerancePoints?: number;
}

export interface PdfParityReport {
  passed: boolean;
  pageCount: { candidate: number; reference: number; exact: boolean };
  pageSize: {
    comparedPages: number;
    mismatchedPages: number;
    maximumWidthDelta: number;
    maximumHeightDelta: number;
  };
  text: {
    candidateCharacters: number;
    referenceCharacters: number;
    candidateTokens: number;
    referenceTokens: number;
    matchedTokens: number;
    similarity: number;
    exact: boolean;
  };
  lineBreaks: {
    candidateLines: number;
    referenceLines: number;
    matchedLines: number;
    similarity: number;
    exact: boolean;
  };
  coordinates: {
    comparedTokens: number;
    pageMismatchedTokens: number;
    meanAbsoluteXDelta: number;
    meanAbsoluteYDelta: number;
    maximumAbsoluteXDelta: number;
    maximumAbsoluteYDelta: number;
    withinTolerance: number;
    withinToleranceShare: number;
  };
}

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IndexedToken extends PdfParityToken {
  pageIndex: number;
}

interface MatchedPair<T> {
  candidate: T;
  reference: T;
}

const DEFAULT_PAGE_SIZE_TOLERANCE = 0.5;
const DEFAULT_COORDINATE_TOLERANCE = 1;

export async function extractPdfParityDocument(bytes: Uint8Array): Promise<PdfParityDocument> {
  const loadingTask = getDocument({ data: Uint8Array.from(bytes), disableFontFace: true });
  const pdf = await loadingTask.promise;
  try {
    const pages: PdfParityPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false });
      const items = content.items.flatMap((item) => ('str' in item ? [positionedItem(item)] : []));
      pages.push({ width: viewport.width, height: viewport.height, lines: groupLines(items) });
      page.cleanup();
    }
    return { pages };
  } finally {
    await loadingTask.destroy();
  }
}

export async function verifyPdfParity(
  candidate: Uint8Array,
  reference: Uint8Array,
  options: PdfParityOptions = {},
): Promise<PdfParityReport> {
  const [candidateDocument, referenceDocument] = await Promise.all([
    extractPdfParityDocument(candidate),
    extractPdfParityDocument(reference),
  ]);
  return comparePdfParityDocuments(candidateDocument, referenceDocument, options);
}

export function comparePdfParityDocuments(
  candidate: PdfParityDocument,
  reference: PdfParityDocument,
  options: PdfParityOptions = {},
): PdfParityReport {
  const pageSizeTolerance = options.pageSizeTolerancePoints ?? DEFAULT_PAGE_SIZE_TOLERANCE;
  const coordinateTolerance = options.coordinateTolerancePoints ?? DEFAULT_COORDINATE_TOLERANCE;
  const pageSize = comparePageSizes(candidate.pages, reference.pages, pageSizeTolerance);
  const candidateText = normalizedDocumentText(candidate);
  const referenceText = normalizedDocumentText(reference);
  const candidateTokens = indexedTokens(candidate);
  const referenceTokens = indexedTokens(reference);
  const tokenPairs = matchSequence(candidateTokens, referenceTokens, (token) => token.text);
  const candidateLines = indexedLines(candidate);
  const referenceLines = indexedLines(reference);
  const linePairs = matchSequence(candidateLines, referenceLines, (line) => line.key);
  const coordinates = compareCoordinates(tokenPairs, coordinateTolerance);
  const textExact = candidateText === referenceText;
  const linesExact = exactSequence(candidateLines, referenceLines, (line) => line.key);
  const pageCountExact = candidate.pages.length === reference.pages.length;

  return {
    passed:
      pageCountExact &&
      pageSize.mismatchedPages === 0 &&
      textExact &&
      linesExact &&
      coordinates.pageMismatchedTokens === 0 &&
      coordinates.withinTolerance === coordinates.comparedTokens,
    pageCount: {
      candidate: candidate.pages.length,
      reference: reference.pages.length,
      exact: pageCountExact,
    },
    pageSize,
    text: {
      candidateCharacters: candidateText.length,
      referenceCharacters: referenceText.length,
      candidateTokens: candidateTokens.length,
      referenceTokens: referenceTokens.length,
      matchedTokens: tokenPairs.length,
      similarity: sequenceSimilarity(
        tokenPairs.length,
        candidateTokens.length,
        referenceTokens.length,
      ),
      exact: textExact,
    },
    lineBreaks: {
      candidateLines: candidateLines.length,
      referenceLines: referenceLines.length,
      matchedLines: linePairs.length,
      similarity: sequenceSimilarity(
        linePairs.length,
        candidateLines.length,
        referenceLines.length,
      ),
      exact: linesExact,
    },
    coordinates,
  };
}

function positionedItem(item: TextItem): PositionedTextItem {
  const transformValue = item.transform as unknown;
  const transform: readonly unknown[] = Array.isArray(transformValue) ? transformValue : [];
  return {
    text: item.str.normalize('NFKC'),
    x: finiteNumber(transform[4]),
    y: finiteNumber(transform[5]),
    width: Math.abs(item.width),
    height: Math.abs(item.height || finiteNumber(transform[3]) || finiteNumber(transform[0])),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function groupLines(items: readonly PositionedTextItem[]): PdfParityLine[] {
  const groups: PositionedTextItem[][] = [];
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
      const ordered = group.sort((first, second) => first.x - second.x);
      const tokens = ordered.flatMap(itemTokens);
      const text = normalizedLine(ordered.map(({ text }) => text).join(' '));
      return text ? [{ text, x: ordered[0]?.x ?? 0, y: ordered[0]?.y ?? 0, tokens }] : [];
    });
}

function comparePosition(first: PositionedTextItem, second: PositionedTextItem): number {
  return second.y - first.y || first.x - second.x;
}

function itemTokens(item: PositionedTextItem): PdfParityToken[] {
  const length = Math.max(1, item.text.length);
  return [...item.text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?|[^\s\p{L}\p{N}]/gu)].map(
    (match) => {
      const start = match.index ?? 0;
      const text = normalizeToken(match[0]);
      return {
        text,
        x: item.x + (item.width * start) / length,
        y: item.y,
        width: (item.width * match[0].length) / length,
        height: item.height,
      };
    },
  );
}

function normalizeToken(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function normalizedLine(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizedDocumentText(document: PdfParityDocument): string {
  return document.pages
    .flatMap((page) => page.lines.map(({ text }) => normalizedLine(text)))
    .filter(Boolean)
    .join('\n');
}

function indexedTokens(document: PdfParityDocument): IndexedToken[] {
  return document.pages.flatMap((page, pageIndex) =>
    page.lines.flatMap((line) => line.tokens.map((token) => ({ ...token, pageIndex }))),
  );
}

function indexedLines(document: PdfParityDocument): { key: string; pageIndex: number }[] {
  return document.pages.flatMap((page, pageIndex) =>
    page.lines.map((line) => ({ key: normalizeToken(line.text), pageIndex })),
  );
}

function comparePageSizes(
  candidate: readonly PdfParityPage[],
  reference: readonly PdfParityPage[],
  tolerance: number,
): PdfParityReport['pageSize'] {
  const comparedPages = Math.min(candidate.length, reference.length);
  let mismatchedPages = Math.abs(candidate.length - reference.length);
  let maximumWidthDelta = 0;
  let maximumHeightDelta = 0;
  for (let index = 0; index < comparedPages; index += 1) {
    const candidatePage = candidate[index]!;
    const referencePage = reference[index]!;
    const widthDelta = Math.abs(candidatePage.width - referencePage.width);
    const heightDelta = Math.abs(candidatePage.height - referencePage.height);
    maximumWidthDelta = Math.max(maximumWidthDelta, widthDelta);
    maximumHeightDelta = Math.max(maximumHeightDelta, heightDelta);
    if (widthDelta > tolerance || heightDelta > tolerance) mismatchedPages += 1;
  }
  return { comparedPages, mismatchedPages, maximumWidthDelta, maximumHeightDelta };
}

function compareCoordinates(
  pairs: readonly MatchedPair<IndexedToken>[],
  tolerance: number,
): PdfParityReport['coordinates'] {
  const deltas = pairs.flatMap(({ candidate, reference }) =>
    candidate.pageIndex === reference.pageIndex
      ? [{ x: Math.abs(candidate.x - reference.x), y: Math.abs(candidate.y - reference.y) }]
      : [],
  );
  const pageMismatchedTokens = pairs.length - deltas.length;
  const xDeltas = deltas.map(({ x }) => x);
  const yDeltas = deltas.map(({ y }) => y);
  const withinTolerance = deltas.filter(({ x, y }) => x <= tolerance && y <= tolerance).length;
  return {
    comparedTokens: deltas.length,
    pageMismatchedTokens,
    meanAbsoluteXDelta: mean(xDeltas),
    meanAbsoluteYDelta: mean(yDeltas),
    maximumAbsoluteXDelta: maximum(xDeltas),
    maximumAbsoluteYDelta: maximum(yDeltas),
    withinTolerance,
    withinToleranceShare: deltas.length ? withinTolerance / deltas.length : 1,
  };
}

function matchSequence<T>(
  candidate: readonly T[],
  reference: readonly T[],
  key: (value: T) => string,
): MatchedPair<T>[] {
  const pairs: MatchedPair<T>[] = [];
  let candidateIndex = 0;
  let referenceIndex = 0;
  const lookahead = 32;
  while (candidateIndex < candidate.length && referenceIndex < reference.length) {
    const candidateValue = candidate[candidateIndex]!;
    const referenceValue = reference[referenceIndex]!;
    if (key(candidateValue) === key(referenceValue)) {
      pairs.push({ candidate: candidateValue, reference: referenceValue });
      candidateIndex += 1;
      referenceIndex += 1;
      continue;
    }
    const candidateSkip = findAhead(candidate, candidateIndex, key(referenceValue), key, lookahead);
    const referenceSkip = findAhead(reference, referenceIndex, key(candidateValue), key, lookahead);
    if (
      candidateSkip !== undefined &&
      (referenceSkip === undefined || candidateSkip <= referenceSkip)
    ) {
      candidateIndex += candidateSkip;
    } else if (referenceSkip !== undefined) {
      referenceIndex += referenceSkip;
    } else {
      candidateIndex += 1;
      referenceIndex += 1;
    }
  }
  return pairs;
}

function findAhead<T>(
  values: readonly T[],
  index: number,
  target: string,
  key: (value: T) => string,
  limit: number,
): number | undefined {
  const end = Math.min(values.length, index + limit + 1);
  for (let cursor = index + 1; cursor < end; cursor += 1) {
    if (key(values[cursor]!) === target) return cursor - index;
  }
  return undefined;
}

function exactSequence<T>(
  candidate: readonly T[],
  reference: readonly T[],
  key: (value: T) => string,
): boolean {
  return (
    candidate.length === reference.length &&
    candidate.every((value, index) => key(value) === key(reference[index]!))
  );
}

function sequenceSimilarity(matches: number, candidate: number, reference: number): number {
  const total = candidate + reference;
  return total ? (matches * 2) / total : 1;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function maximum(values: readonly number[]): number {
  return values.length ? Math.max(...values) : 0;
}
