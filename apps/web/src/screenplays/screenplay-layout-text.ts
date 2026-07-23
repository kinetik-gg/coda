import type { ScreenplayPaperSpecification } from './screenplay-paper';
import {
  SCREENPLAY_BLOCK_SPACING,
  type ScreenplayLayoutBlankLine,
  type ScreenplayLayoutLine,
  type ScreenplayPreviewBlock,
  type ScreenplayPreviewBlockKind,
  type ScreenplayPreviewInlineStyle,
} from './screenplay-preview-types';
import { screenplayGraphemes } from './screenplay-graphemes';

export interface LayoutLineDraft {
  block: ScreenplayPreviewBlock;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  textSourceOffsets?: readonly number[];
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
  continuation?: 'more' | 'continued';
  layoutSpacer?: true;
}

export interface WrappedTextRange {
  text: string;
  from: number;
  to: number;
}

export function lineFont(kind: ScreenplayPreviewBlockKind): ScreenplayLayoutLine['font'] {
  if (kind === 'character' || kind === 'scene-heading' || kind === 'transition') return 'bold';
  if (kind === 'lyric') return 'italic';
  return 'regular';
}

export function linePlacement(
  kind: ScreenplayPreviewBlockKind,
  paper: ScreenplayPaperSpecification,
  dualColumn?: 'left' | 'right',
): { x: number; columns: number; align: ScreenplayLayoutLine['align'] } {
  if (dualColumn) return dualPlacement(kind, paper, dualColumn);
  switch (kind) {
    case 'character':
      return {
        x: paper.leftMargin + 19 * paper.glyphWidth,
        columns: paper.characterColumns,
        align: 'left',
      };
    case 'dialogue':
      return {
        x: paper.leftMargin + 10 * paper.glyphWidth,
        columns: paper.dialogueColumns,
        align: 'left',
      };
    case 'parenthetical':
      return {
        x: paper.leftMargin + 15 * paper.glyphWidth,
        columns: paper.parentheticalColumns,
        align: 'left',
      };
    case 'centered':
      return {
        x: paper.leftMargin,
        columns: paper.id === 'letter' ? 62 : paper.actionColumns,
        align: 'center',
      };
    case 'lyric':
      return {
        x: paper.leftMargin + 10 * paper.glyphWidth,
        columns: paper.dialogueColumns,
        align: 'left',
      };
    case 'transition':
      return { x: paper.leftMargin, columns: paper.actionColumns, align: 'right' };
    case 'scene-heading':
      return {
        x: paper.leftMargin + (paper.id === 'letter' ? 0.75 : 0),
        columns: paper.sceneHeadingColumns,
        align: 'left',
      };
    case 'action':
    case 'title-page':
      return { x: paper.leftMargin, columns: paper.actionColumns, align: 'left' };
  }
}

function dualPlacement(
  kind: ScreenplayPreviewBlockKind,
  paper: ScreenplayPaperSpecification,
  dualColumn: 'left' | 'right',
) {
  const base = paper.bodyFrameLeft + (dualColumn === 'right' ? 30 * paper.glyphWidth : 0);
  if (kind === 'character') {
    return {
      x: base + 7 * paper.glyphWidth,
      columns: paper.dualCharacterColumns,
      align: 'left' as const,
    };
  }
  if (kind === 'parenthetical') {
    return {
      x: base + 4 * paper.glyphWidth,
      columns: paper.dualParentheticalColumns,
      align: 'left' as const,
    };
  }
  return { x: base, columns: paper.dualDialogueColumns, align: 'left' as const };
}

export function dialogueDrafts(
  blocks: readonly ScreenplayPreviewBlock[],
  paper: ScreenplayPaperSpecification,
  dualColumn?: 'left' | 'right',
): readonly LayoutLineDraft[] {
  return blocks.flatMap((block, index) => [
    ...(index > 0
      ? Array.from(
          { length: SCREENPLAY_BLOCK_SPACING[block.kind] ?? 0 },
          () =>
            ({
              block,
              text: '',
              sourceStart: block.sourceStart,
              sourceEnd: block.sourceStart,
              layoutSpacer: true,
            }) satisfies LayoutLineDraft,
        )
      : []),
    ...wrapBlock(block, paper, dualColumn),
  ]);
}

export function wrapBlock(
  block: ScreenplayPreviewBlock,
  paper: ScreenplayPaperSpecification,
  dualColumn?: 'left' | 'right',
): readonly LayoutLineDraft[] {
  const blankLinesBefore = blankLineDrafts(block, block.layoutBlankLinesBefore);
  const blankLinesAfter = blankLineDrafts(block, block.layoutBlankLinesAfter);
  const sourceText = block.displayText ?? block.text;
  const text = sourceText;
  const columns = linePlacement(block.kind, paper, dualColumn).columns;
  const wrapped = wrapTextRanges(
    text,
    columns,
    block.kind === 'parenthetical' ? columns - 1 : undefined,
  );
  return [
    ...blankLinesBefore,
    ...wrapped.map((line) => draftFromWrappedLine(block, line)),
    ...blankLinesAfter,
  ];
}

function blankLineDrafts(
  block: ScreenplayPreviewBlock,
  lines: readonly ScreenplayLayoutBlankLine[] | undefined,
): LayoutLineDraft[] {
  return (lines ?? []).map((line) => ({
    block,
    text: '',
    sourceStart: line.sourceStart,
    sourceEnd: line.sourceEnd,
  }));
}

function draftFromWrappedLine(
  block: ScreenplayPreviewBlock,
  line: WrappedTextRange,
): LayoutLineDraft {
  const offsetEnd =
    line.text === '' && line.from < (block.textSourceOffsets?.length ?? 0) - 1
      ? line.from + 1
      : line.to;
  const offsets = block.textSourceOffsets?.slice(line.from, offsetEnd + 1);
  const inlineStyles = sliceInlineStyles(block.inlineStyles, line.from, line.to);
  return {
    block,
    text: line.text,
    sourceStart: offsets?.[0] ?? block.sourceStart,
    sourceEnd: offsets?.at(-1) ?? block.sourceEnd,
    ...(offsets ? { textSourceOffsets: offsets } : {}),
    ...(inlineStyles.length ? { inlineStyles } : {}),
  };
}

export function sliceInlineStyles(
  styles: readonly ScreenplayPreviewInlineStyle[] | undefined,
  from: number,
  to: number,
): ScreenplayPreviewInlineStyle[] {
  return (styles ?? []).flatMap((style) => {
    const start = Math.max(style.from, from);
    const end = Math.min(style.to, to);
    return start < end ? [{ ...style, from: start - from, to: end - from }] : [];
  });
}

export function uppercasePreservingLength(value: string): string {
  return value.replace(/./gu, (character) => {
    const upper = character.toLocaleUpperCase();
    return upper.length === character.length ? upper : character;
  });
}

export function continuationDraft(
  cue: LayoutLineDraft,
  continuation: 'more' | 'continued',
): LayoutLineDraft {
  return {
    block: cue.block,
    text:
      continuation === 'more' ? '(MORE)' : `${cue.text.replace(/\s*\(CONT'D\)$/iu, '')} (CONT'D)`,
    sourceStart: cue.sourceStart,
    sourceEnd: cue.sourceEnd,
    continuation,
  };
}

export function wrapTextRanges(
  text: string,
  columns: number,
  continuationColumns = columns,
): WrappedTextRange[] {
  const lines: WrappedTextRange[] = [];
  let paragraphStart = 0;
  for (const paragraph of text.split('\n')) {
    paragraphStart = wrapParagraph(lines, paragraph, paragraphStart, columns, continuationColumns);
  }
  return lines;
}

function wrapParagraph(
  lines: WrappedTextRange[],
  paragraph: string,
  paragraphStart: number,
  columns: number,
  continuationColumns: number,
): number {
  if (!paragraph.length) {
    lines.push({ text: '', from: paragraphStart, to: paragraphStart });
    return paragraphStart + 1;
  }
  const graphemes = screenplayGraphemes(paragraph);
  let cursor = 0;
  let graphemeCursor = 0;
  while (graphemeCursor < graphemes.length) {
    const lineColumns = positiveColumnCount(lines.length === 0 ? columns : continuationColumns);
    const end = wrappedLineEnd(graphemes, graphemeCursor, lineColumns, paragraph.length);
    const rendered = paragraph.slice(cursor, end).trimEnd();
    lines.push({
      text: rendered,
      from: paragraphStart + cursor,
      to: paragraphStart + cursor + rendered.length,
    });
    cursor = skipWhitespace(paragraph, end);
    while (graphemeCursor < graphemes.length && (graphemes[graphemeCursor]?.end ?? 0) <= cursor) {
      graphemeCursor += 1;
    }
  }
  return paragraphStart + paragraph.length + 1;
}

function wrappedLineEnd(
  graphemes: ReturnType<typeof screenplayGraphemes>,
  cursor: number,
  columns: number,
  paragraphLength: number,
): number {
  const visibleEnd = cursor + columns;
  if (visibleEnd >= graphemes.length) return paragraphLength;
  const boundary = graphemes[visibleEnd];
  if (boundary && /^[ \t]$/u.test(boundary.text)) return boundary.start;
  for (let index = visibleEnd - 1; index > cursor; index -= 1) {
    const grapheme = graphemes[index];
    if (grapheme && /^[ \t]$/u.test(grapheme.text)) return grapheme.start;
  }
  return graphemes[visibleEnd - 1]?.end ?? paragraphLength;
}

function positiveColumnCount(columns: number): number {
  return Math.max(1, Math.floor(columns));
}

function skipWhitespace(paragraph: string, start: number): number {
  let cursor = start;
  while (cursor < paragraph.length && /[ \t]/u.test(paragraph[cursor] ?? '')) cursor += 1;
  return cursor;
}
