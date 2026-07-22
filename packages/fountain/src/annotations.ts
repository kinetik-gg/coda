import type { FountainAnnotation, FountainEmphasisAnnotation } from './types';

const EMPHASIS_MARKERS = [
  { marker: '***', kind: 'bold_italic' },
  { marker: '**', kind: 'bold' },
  { marker: '*', kind: 'italic' },
  { marker: '_', kind: 'underline' },
] as const;

export function collectAnnotations(source: string): FountainAnnotation[] {
  const annotations: FountainAnnotation[] = [
    ...collectDelimited(source, '[[', ']]', 'note'),
    ...collectDelimited(source, '/*', '*/', 'boneyard'),
    ...collectEmphasis(source),
  ];
  return annotations.sort((left, right) => left.start - right.start || right.end - left.end);
}

function collectDelimited(
  source: string,
  opener: string,
  closer: string,
  kind: 'note' | 'boneyard',
): FountainAnnotation[] {
  const annotations: FountainAnnotation[] = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const start = findUnescaped(source, opener, searchFrom);
    if (start < 0) break;
    const closeStart = findUnescaped(source, closer, start + opener.length);
    const closed = closeStart >= 0;
    const end = closed ? closeStart + closer.length : source.length;
    annotations.push({
      kind,
      start,
      end,
      contentStart: start + opener.length,
      contentEnd: closed ? closeStart : source.length,
      closed,
    });
    searchFrom = end;
  }
  return annotations;
}

function collectEmphasis(source: string): FountainEmphasisAnnotation[] {
  const annotations: FountainEmphasisAnnotation[] = [];
  let lineStart = 0;
  while (lineStart < source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    annotations.push(...collectLineEmphasis(source, lineStart, lineEnd));
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return annotations;
}

function collectLineEmphasis(
  source: string,
  lineStart: number,
  lineEnd: number,
): FountainEmphasisAnnotation[] {
  const annotations: FountainEmphasisAnnotation[] = [];
  let cursor = lineStart;
  while (cursor < lineEnd) {
    const definition = EMPHASIS_MARKERS.find(({ marker }) => source.startsWith(marker, cursor));
    if (!definition || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const close = findUnescaped(
      source,
      definition.marker,
      cursor + definition.marker.length,
      lineEnd,
    );
    if (close <= cursor + definition.marker.length) {
      cursor += definition.marker.length;
      continue;
    }
    annotations.push({
      kind: definition.kind,
      start: cursor,
      end: close + definition.marker.length,
      contentStart: cursor + definition.marker.length,
      contentEnd: close,
    });
    cursor = close + definition.marker.length;
  }
  return annotations;
}

function findUnescaped(source: string, value: string, from: number, limit = source.length): number {
  let match = source.indexOf(value, from);
  while (match >= 0 && match < limit) {
    if (!isEscaped(source, match)) return match;
    match = source.indexOf(value, match + value.length);
  }
  return -1;
}

function isEscaped(source: string, position: number): boolean {
  let slashCount = 0;
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
