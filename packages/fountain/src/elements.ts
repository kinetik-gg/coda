import { matchSceneHeading, isTransition } from './classification';
import { hasBlankContext, isUnconnectedNoteBlank, parsingText } from './source-lines';
import type {
  FountainActionElement,
  FountainElement,
  FountainMarkerTextElement,
  FountainSourceLine,
} from './types';

export function parseStandaloneElement(
  source: string,
  lines: readonly FountainSourceLine[],
  index: number,
): { element: FountainElement; nextLine: number } | undefined {
  const line = lines[index];
  if (!line) return undefined;
  const text = parsingText(line);
  const trimmed = text.trim();

  if (trimmed === '') return single(source, line, { kind: 'separator' });
  if (trimmed.startsWith('/*')) return delimited(source, lines, index, 'boneyard', '*/');
  if (trimmed.startsWith('[[')) return delimited(source, lines, index, 'note', ']]');
  if (/^={3,}\s*$/u.test(trimmed)) return single(source, line, { kind: 'page_break' });

  const section = /^(#{1,})\s*(.*)$/u.exec(trimmed);
  if (section) {
    return marker(source, line, {
      kind: 'section',
      text: section[2] ?? '',
      depth: section[1]?.length ?? 1,
    });
  }
  const synopsis = /^=(?!=)\s*(.*)$/u.exec(trimmed);
  if (synopsis) return marker(source, line, { kind: 'synopsis', text: synopsis[1] ?? '' });

  const scene = matchSceneHeading(text);
  if (scene && (scene.forced || hasBlankContext(lines, index))) {
    return single(source, line, { kind: 'scene_heading', ...scene });
  }

  // `!` forces Action even when the remaining text resembles a transition.
  if (trimmed.startsWith('!')) return undefined;

  if (/^>.*<$/u.test(trimmed)) {
    return marker(source, line, { kind: 'centered', text: trimmed.slice(1, -1).trim() });
  }
  if (trimmed.startsWith('>')) {
    return marker(source, line, {
      kind: 'transition',
      text: trimmed.slice(1).trimStart(),
      forced: true,
    });
  }
  if (isTransition(text) && hasBlankContext(lines, index)) {
    return marker(source, line, { kind: 'transition', text: trimmed, forced: false });
  }
  if (trimmed.startsWith('~')) {
    return marker(source, line, { kind: 'lyric', text: trimmed.slice(1) });
  }
  return undefined;
}

export function actionElement(
  source: string,
  lines: readonly FountainSourceLine[],
  startIndex: number,
  endIndex: number,
): FountainActionElement {
  const first = lines[startIndex];
  const last = lines[endIndex];
  if (!first || !last) throw new RangeError('Action element requires a valid line range');
  const firstText = parsingText(first);
  const forced = firstText.trimStart().startsWith('!');
  const text = normalizedLineText(lines, startIndex, endIndex, {
    expandTabs: true,
    ...(forced ? { removeFirstMarker: '!' } : {}),
  });
  return base(source, first, last, { kind: 'action', text, forced });
}

export function base<T extends object>(
  source: string,
  first: FountainSourceLine,
  last: FountainSourceLine,
  properties: T,
): T & { start: number; end: number; raw: string; lineStart: number; lineEnd: number } {
  return {
    ...properties,
    start: first.start,
    end: last.end,
    raw: source.slice(first.start, last.end),
    lineStart: first.index,
    lineEnd: last.index,
  };
}

export function normalizedLineText(
  lines: readonly FountainSourceLine[],
  startIndex: number,
  endIndex: number,
  options: {
    expandTabs?: boolean;
    removeFirstMarker?: string;
    stripLeadingIndent?: boolean;
  } = {},
): string {
  const values: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const line = lines[index];
    if (!line) continue;
    let value = parsingText(line);
    if (index === startIndex && options.removeFirstMarker) {
      const markerIndex = value.indexOf(options.removeFirstMarker);
      if (markerIndex >= 0) {
        value =
          value.slice(0, markerIndex) + value.slice(markerIndex + options.removeFirstMarker.length);
      }
    }
    if (options.stripLeadingIndent) value = value.trimStart();
    if (options.expandTabs) value = value.replace(/\t/gu, '    ');
    values.push(value);
  }
  return values.join('\n');
}

function single<T extends object>(source: string, line: FountainSourceLine, properties: T) {
  return { element: base(source, line, line, properties), nextLine: line.index + 1 };
}

function marker(
  source: string,
  line: FountainSourceLine,
  properties:
    | Pick<FountainMarkerTextElement, 'kind' | 'text'>
    | { kind: 'transition'; text: string; forced: boolean }
    | { kind: 'section'; text: string; depth: number },
): { element: FountainMarkerTextElement; nextLine: number } {
  const element = base(source, line, line, properties) as FountainMarkerTextElement;
  return { element, nextLine: line.index + 1 };
}

function delimited(
  source: string,
  lines: readonly FountainSourceLine[],
  startIndex: number,
  kind: 'note' | 'boneyard',
  closer: ']]' | '*/',
): { element: FountainElement; nextLine: number } | undefined {
  const first = lines[startIndex];
  if (!first) return undefined;
  let endIndex = startIndex;
  let closeStart = findUnescapedCloser(source, first, closer);
  while (closeStart === undefined && endIndex + 1 < lines.length) {
    const next = lines[endIndex + 1];
    if (!next || (kind === 'note' && isUnconnectedNoteBlank(parsingText(next)))) break;
    endIndex += 1;
    const line = lines[endIndex];
    closeStart = line ? findUnescapedCloser(source, line, closer) : undefined;
  }
  const last = lines[endIndex] ?? first;
  const raw = source.slice(first.start, last.contentEnd);
  const opener = kind === 'note' ? '[[' : '/*';
  const openerAt = raw.indexOf(opener);
  const closingStart = closeStart;
  const closed = closingStart !== undefined;
  const textEnd = closingStart === undefined ? raw.length : closingStart - first.start;
  const text = raw.slice(openerAt + opener.length, textEnd);
  const remainder =
    closingStart === undefined ? '' : source.slice(closingStart + closer.length, last.contentEnd);
  if (remainder.trim() !== '') {
    return {
      element: base(source, first, last, {
        kind: 'action',
        text: normalizedLineText(lines, startIndex, endIndex, { expandTabs: true }),
        forced: false,
      }),
      nextLine: endIndex + 1,
    };
  }
  return { element: base(source, first, last, { kind, text, closed }), nextLine: endIndex + 1 };
}

function findUnescapedCloser(
  source: string,
  line: FountainSourceLine,
  closer: ']]' | '*/',
): number | undefined {
  let match = source.indexOf(closer, line.contentStart);
  while (match >= 0 && match < line.contentEnd) {
    let slashCount = 0;
    for (let index = match - 1; index >= line.contentStart && source[index] === '\\'; index -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return match;
    match = source.indexOf(closer, match + closer.length);
  }
  return undefined;
}
