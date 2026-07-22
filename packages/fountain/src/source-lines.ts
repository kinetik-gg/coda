import type { FountainLineEnding, FountainSourceLine } from './types';

export function splitSourceLines(source: string): FountainSourceLine[] {
  const lines: FountainSourceLine[] = [];
  let start = 0;
  let index = 0;

  while (start < source.length) {
    const newline = source.indexOf('\n', start);
    if (newline < 0) {
      lines.push(makeLine(source, index, start, source.length, ''));
      break;
    }

    const isCrLf = newline > start && source[newline - 1] === '\r';
    const contentEnd = isCrLf ? newline - 1 : newline;
    const ending = isCrLf ? '\r\n' : '\n';
    lines.push(makeLine(source, index, start, contentEnd, ending));
    start = newline + 1;
    index += 1;
  }

  return lines;
}

function makeLine(
  source: string,
  index: number,
  start: number,
  contentEnd: number,
  ending: '' | '\n' | '\r\n',
): FountainSourceLine {
  return {
    index,
    start,
    end: contentEnd + ending.length,
    contentStart: start,
    contentEnd,
    text: source.slice(start, contentEnd),
    ending,
  };
}

export function detectLineEnding(lines: readonly FountainSourceLine[]): FountainLineEnding {
  let hasLf = false;
  let hasCrLf = false;
  for (const line of lines) {
    hasLf ||= line.ending === '\n';
    hasCrLf ||= line.ending === '\r\n';
  }

  if (hasLf && hasCrLf) return 'mixed';
  if (hasCrLf) return 'crlf';
  if (hasLf) return 'lf';
  return 'none';
}

export function parsingText(line: FountainSourceLine): string {
  return line.index === 0 && line.text.startsWith('\uFEFF') ? line.text.slice(1) : line.text;
}
