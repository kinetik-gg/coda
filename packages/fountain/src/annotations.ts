import type { FountainAnnotation, FountainEmphasisAnnotation } from './types';
import { isUnconnectedNoteBlank } from './source-lines';

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

export function stripHiddenAnnotations(text: string): string {
  const hidden = collectAnnotations(text).filter(
    (annotation) => annotation.kind === 'note' || annotation.kind === 'boneyard',
  );
  if (!hidden.length) return text;

  let result = '';
  let cursor = 0;
  for (const annotation of hidden) {
    if (annotation.end <= cursor) continue;
    result += text.slice(cursor, Math.max(cursor, annotation.start));
    cursor = annotation.end;
  }
  return result + text.slice(cursor);
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
    const match =
      kind === 'note'
        ? findNoteEnd(source, start + opener.length, closer)
        : {
            closeStart: findUnescaped(source, closer, start + opener.length),
            limit: source.length,
          };
    const closed = match.closeStart >= 0;
    const contentEnd = closed ? match.closeStart : match.limit;
    const end = closed ? match.closeStart + closer.length : match.limit;
    annotations.push({
      kind,
      start,
      end,
      contentStart: start + opener.length,
      contentEnd,
      closed,
    });
    searchFrom = Math.max(end, start + opener.length);
  }
  return annotations;
}

function findNoteEnd(
  source: string,
  from: number,
  closer: string,
): { closeStart: number; limit: number } {
  let cursor = from;
  while (cursor < source.length) {
    const closeStart = source.indexOf(closer, cursor);
    const newline = source.indexOf('\n', cursor);
    if (closeStart >= 0 && (newline < 0 || closeStart < newline)) {
      if (!isEscaped(source, closeStart)) return { closeStart, limit: source.length };
      cursor = closeStart + closer.length;
      continue;
    }
    if (newline < 0) break;

    const nextLineStart = newline + 1;
    const nextNewline = source.indexOf('\n', nextLineStart);
    const nextLineEnd = nextNewline < 0 ? source.length : nextNewline;
    const contentEnd =
      nextLineEnd > nextLineStart && source[nextLineEnd - 1] === '\r'
        ? nextLineEnd - 1
        : nextLineEnd;
    if (isUnconnectedNoteBlank(source.slice(nextLineStart, contentEnd))) {
      return { closeStart: -1, limit: nextLineStart };
    }
    cursor = nextLineStart;
  }
  return { closeStart: -1, limit: source.length };
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
  const stack: EmphasisOpener[] = [];
  const openerIndexes: Record<EmphasisMarker, number[]> = {
    '***': [],
    '**': [],
    '*': [],
    _: [],
  };
  let cursor = lineStart;
  while (cursor < lineEnd) {
    const character = source[cursor];
    if ((character !== '*' && character !== '_') || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const runLength = markerRunLength(source, cursor, lineEnd, character);
    let consumed = 0;
    while (consumed < runLength) {
      const position = cursor + consumed;
      const remaining = runLength - consumed;
      if (canClose(source, position, lineStart)) {
        const openerIndex = matchingOpenerIndex(openerIndexes, character, remaining);
        const opener = openerIndex < 0 ? undefined : stack[openerIndex];
        if (opener) {
          const markerLength = opener.marker.length;
          popThrough(stack, openerIndexes, openerIndex);
          annotations.push(closeEmphasis(opener, position));
          consumed += markerLength;
          continue;
        }
      }

      const definition = openingDefinition(character, remaining);
      if (!definition || !canOpen(source, position, definition.marker.length, lineEnd)) {
        consumed += 1;
        continue;
      }
      const stackIndex = stack.length;
      stack.push({
        ...definition,
        start: position,
        contentStart: position + definition.marker.length,
      });
      openerIndexes[definition.marker].push(stackIndex);
      consumed += definition.marker.length;
    }
    cursor += runLength;
  }
  return annotations.sort((left, right) => left.start - right.start || right.end - left.end);
}

function matchingOpenerIndex(
  openerIndexes: Readonly<Record<EmphasisMarker, readonly number[]>>,
  marker: '*' | '_',
  remaining: number,
): number {
  let closest = -1;
  for (const definition of EMPHASIS_MARKERS) {
    if (definition.marker[0] !== marker || definition.marker.length > remaining) continue;
    const candidate = openerIndexes[definition.marker].at(-1);
    if (candidate !== undefined && candidate > closest) closest = candidate;
  }
  return closest;
}

function popThrough(
  stack: EmphasisOpener[],
  openerIndexes: Record<EmphasisMarker, number[]>,
  openerIndex: number,
): void {
  while (stack.length > openerIndex) {
    const discarded = stack.pop();
    if (discarded) openerIndexes[discarded.marker].pop();
  }
}

type EmphasisMarker = (typeof EMPHASIS_MARKERS)[number]['marker'];

interface EmphasisOpener {
  marker: EmphasisMarker;
  kind: FountainEmphasisAnnotation['kind'];
  start: number;
  contentStart: number;
}

function markerRunLength(
  source: string,
  start: number,
  lineEnd: number,
  marker: '*' | '_',
): number {
  let end = start + 1;
  while (end < lineEnd && source[end] === marker) end += 1;
  return end - start;
}

function openingDefinition(marker: '*' | '_', remaining: number) {
  if (marker === '_') return EMPHASIS_MARKERS[3];
  if (remaining >= 3) return EMPHASIS_MARKERS[0];
  if (remaining === 2) return EMPHASIS_MARKERS[1];
  return EMPHASIS_MARKERS[2];
}

function canOpen(source: string, position: number, markerLength: number, lineEnd: number): boolean {
  const next = position + markerLength;
  return next < lineEnd && !/\s/u.test(source[next] ?? '');
}

function canClose(source: string, position: number, lineStart: number): boolean {
  return position > lineStart && !/\s/u.test(source[position - 1] ?? '');
}

function closeEmphasis(opener: EmphasisOpener, closeStart: number): FountainEmphasisAnnotation {
  return {
    kind: opener.kind,
    start: opener.start,
    end: closeStart + opener.marker.length,
    contentStart: opener.contentStart,
    contentEnd: closeStart,
  };
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
