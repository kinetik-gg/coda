import type { Document, Element } from '@xmldom/xmldom';
import { parseFountain } from '../parser';
import type { FountainEmphasisAnnotation } from '../types';

type InlineStyle = 'Bold' | 'Italic' | 'Underline';

interface FdxTextRun {
  text: string;
  style: string;
}

export function appendFdxTextRuns(document: Document, paragraph: Element, text: string): void {
  const runs = fountainTextRuns(text);
  if (runs.length === 0) {
    paragraph.appendChild(document.createElement('Text'));
    return;
  }
  for (const run of runs) {
    const textElement = document.createElement('Text');
    if (run.style !== '') textElement.setAttribute('Style', run.style);
    textElement.appendChild(document.createTextNode(run.text));
    paragraph.appendChild(textElement);
  }
}

export function paragraphFountainText(paragraph: Element, warnings: Set<string>): string {
  const textElements = paragraph.getElementsByTagName('Text');
  const runs: Array<{ text: string; styles: readonly InlineStyle[] }> = [];
  for (let index = 0; index < textElements.length; index += 1) {
    const element = textElements.item(index);
    const text = element?.textContent;
    if (!element || !text) continue;
    const styles = parseFdxStyles(element.getAttribute('Style'), warnings);
    const previous = runs.at(-1);
    if (previous && styleKey(previous.styles) === styleKey(styles)) previous.text += text;
    else runs.push({ text, styles });
  }
  return runs.map((run) => fountainStyledText(run.text, run.styles, warnings)).join('');
}

function fountainTextRuns(text: string): FdxTextRun[] {
  const annotations = parseFountain(text).annotations.filter(
    (annotation): annotation is FountainEmphasisAnnotation =>
      annotation.kind === 'bold' ||
      annotation.kind === 'italic' ||
      annotation.kind === 'bold_italic' ||
      annotation.kind === 'underline',
  );
  const additions = new Map<number, InlineStyle[]>();
  const removals = new Map<number, InlineStyle[]>();
  const skipped = new Uint8Array(text.length);
  for (const annotation of annotations) {
    const styles = annotationStyles(annotation.kind);
    addEvents(additions, annotation.contentStart, styles);
    addEvents(removals, annotation.contentEnd, styles);
    skipped.fill(1, annotation.start, annotation.contentStart);
    skipped.fill(1, annotation.contentEnd, annotation.end);
  }

  const active: Record<InlineStyle, number> = { Bold: 0, Italic: 0, Underline: 0 };
  const runs: FdxTextRun[] = [];
  for (let index = 0; index < text.length; index += 1) {
    applyEvents(active, removals.get(index), -1);
    applyEvents(active, additions.get(index), 1);
    if (skipped[index] === 1) continue;
    let value = text[index] ?? '';
    const next = text[index + 1];
    if (value === '\\' && next && /[\\*_]/u.test(next) && skipped[index + 1] !== 1) {
      value = next;
      index += 1;
    }
    appendRun(runs, value, activeStyle(active));
  }
  return runs;
}

function annotationStyles(kind: FountainEmphasisAnnotation['kind']): InlineStyle[] {
  if (kind === 'bold_italic') return ['Bold', 'Italic'];
  if (kind === 'bold') return ['Bold'];
  if (kind === 'italic') return ['Italic'];
  return ['Underline'];
}

function addEvents(
  events: Map<number, InlineStyle[]>,
  position: number,
  styles: readonly InlineStyle[],
): void {
  const current = events.get(position) ?? [];
  current.push(...styles);
  events.set(position, current);
}

function applyEvents(
  active: Record<InlineStyle, number>,
  styles: readonly InlineStyle[] | undefined,
  change: 1 | -1,
): void {
  for (const style of styles ?? []) active[style] = Math.max(0, active[style] + change);
}

function activeStyle(active: Readonly<Record<InlineStyle, number>>): string {
  return (['Bold', 'Italic', 'Underline'] as const).filter((style) => active[style] > 0).join('+');
}

function appendRun(runs: FdxTextRun[], text: string, style: string): void {
  if (text === '') return;
  const previous = runs.at(-1);
  if (previous?.style === style) previous.text += text;
  else runs.push({ text, style });
}

function parseFdxStyles(value: string | null, warnings: Set<string>): readonly InlineStyle[] {
  if (!value?.trim()) return [];
  const styles = new Set<InlineStyle>();
  for (const token of value.split(/[+,\s]+/u).filter(Boolean)) {
    const normalized = token.toLowerCase();
    if (normalized === 'bold') styles.add('Bold');
    else if (normalized === 'italic') styles.add('Italic');
    else if (normalized === 'underline') styles.add('Underline');
    else warnings.add(`Unsupported Final Draft text style “${token}” was ignored.`);
  }
  return (['Bold', 'Italic', 'Underline'] as const).filter((style) => styles.has(style));
}

function styleKey(styles: readonly InlineStyle[]): string {
  return styles.join('+');
}

function fountainStyledText(
  text: string,
  styles: readonly InlineStyle[],
  warnings: Set<string>,
): string {
  return text
    .split('\n')
    .map((line) => fountainStyledLine(line, styles, warnings))
    .join('\n');
}

function fountainStyledLine(
  line: string,
  styles: readonly InlineStyle[],
  warnings: Set<string>,
): string {
  const leading = /^[\t ]*/u.exec(line)?.[0] ?? '';
  const trailing = /[\t ]*$/u.exec(line)?.[0] ?? '';
  const coreEnd = Math.max(leading.length, line.length - trailing.length);
  const core = line.slice(leading.length, coreEnd);
  const plain = escapeFountainText(core);
  if (styles.length === 0 || core === '') return escapeFountainText(line);
  if (leading !== '' || trailing !== '') {
    warnings.add(
      'Whitespace at a Final Draft style boundary was preserved outside Fountain emphasis markers.',
    );
  }
  const hasBold = styles.includes('Bold');
  const hasItalic = styles.includes('Italic');
  let styled = plain;
  if (hasBold && hasItalic) styled = `***${styled}***`;
  else if (hasBold) styled = `**${styled}**`;
  else if (hasItalic) styled = `*${styled}*`;
  if (styles.includes('Underline')) styled = `_${styled}_`;
  return `${escapeFountainText(leading)}${styled}${escapeFountainText(trailing)}`;
}

function escapeFountainText(text: string): string {
  return text.replace(/[\\*_]/gu, '\\$&');
}
