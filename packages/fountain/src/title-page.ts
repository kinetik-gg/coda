import { parsingText } from './source-lines';
import type { FountainSourceLine, FountainTitleField, FountainTitlePageElement } from './types';

interface TitlePageParseResult {
  element: FountainTitlePageElement;
  nextLine: number;
}

const TITLE_FIELD = /^([^:\r\n]+):(?:[ \t]*(.*))$/;

export function parseTitlePage(
  source: string,
  lines: readonly FountainSourceLine[],
): TitlePageParseResult | undefined {
  const first = lines[0];
  if (!first || !TITLE_FIELD.test(parsingText(first))) return undefined;

  const fields: FountainTitleField[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || parsingText(line).trim() === '') break;
    const parsed = parseField(source, lines, cursor);
    if (!parsed) break;
    fields.push(parsed.field);
    cursor = parsed.nextLine;
  }

  if (fields.length === 0) return undefined;
  const lastLine = lines[cursor - 1];
  if (!lastLine) return undefined;
  return {
    element: {
      kind: 'title_page',
      start: 0,
      end: lastLine.end,
      raw: source.slice(0, lastLine.end),
      lineStart: 0,
      lineEnd: lastLine.index,
      fields,
    },
    nextLine: cursor,
  };
}

function parseField(
  source: string,
  lines: readonly FountainSourceLine[],
  startIndex: number,
): { field: FountainTitleField; nextLine: number } | undefined {
  const first = lines[startIndex];
  if (!first) return undefined;
  const match = TITLE_FIELD.exec(parsingText(first));
  if (!match) return undefined;

  const valueLines = [match[2] ?? ''];
  let cursor = startIndex + 1;
  while (cursor < lines.length) {
    const continuation = lines[cursor];
    if (!continuation || !isContinuation(parsingText(continuation))) break;
    valueLines.push(parsingText(continuation).replace(/^(?: {3,}|\t)/, ''));
    cursor += 1;
  }

  const last = lines[cursor - 1] ?? first;
  const semanticValueLines =
    valueLines[0] === '' && valueLines.length > 1 ? valueLines.slice(1) : valueLines;
  return {
    field: {
      key: (match[1] ?? '').trim(),
      value: semanticValueLines.join('\n'),
      valueLines,
      start: first.start,
      end: last.end,
      raw: source.slice(first.start, last.end),
    },
    nextLine: cursor,
  };
}

function isContinuation(text: string): boolean {
  return /^(?: {3,}|\t)\S/.test(text);
}
