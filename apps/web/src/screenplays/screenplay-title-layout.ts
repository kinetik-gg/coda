import type { ScreenplayPaperSpecification } from './screenplay-paper';
import {
  sliceInlineStyles,
  uppercasePreservingLength,
  wrapTextRanges,
} from './screenplay-layout-text';
import type {
  ScreenplayLayoutLine,
  ScreenplayPreviewBlock,
  ScreenplayPreviewInlineStyle,
  ScreenplayPreviewPage,
  ScreenplayPreviewTitleField,
} from './screenplay-preview-types';

interface TitleGeometry {
  glyph: number;
  side: number;
  leftWidth: number;
  rightWidth: number;
  topWidth: number;
}

interface TitleLineInput {
  text: string;
  x: number;
  baselineY: number;
  width: number;
  align: ScreenplayLayoutLine['align'];
  sourceStart: number;
  sourceEnd: number;
  textSourceOffsets?: readonly number[];
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
}

interface BottomTitleLine {
  text: string;
  start: number;
  end: number;
  offsets?: readonly number[];
  styles?: readonly ScreenplayPreviewInlineStyle[];
}

interface TitleLinePlacement {
  x: number;
  baselineY: number;
  width: number;
  align: ScreenplayLayoutLine['align'];
}

interface BottomColumnPlacement {
  x: number;
  width: number;
  align: ScreenplayLayoutLine['align'];
}

export function layoutTitlePage(
  block: ScreenplayPreviewBlock,
  paper: ScreenplayPaperSpecification,
): ScreenplayPreviewPage {
  const lines: ScreenplayLayoutLine[] = [];
  const geometry = titleGeometry(paper);
  const addLine = titleLineAppender(block, geometry, lines);
  const topFields = (block.titleFields ?? []).filter((field) => isTopField(field.key));
  const bottomFields = (block.titleFields ?? []).filter((field) => !isTopField(field.key));
  appendTopFields(topFields, block, paper, geometry, addLine);
  appendBottomFields(bottomFields, block, paper, geometry, addLine);
  return Object.freeze({
    id: 'preview-title-page',
    pageNumber: null,
    blocks: Object.freeze([block]),
    lines: Object.freeze(lines.map((line) => Object.freeze(line))),
  });
}

function titleGeometry(paper: ScreenplayPaperSpecification): TitleGeometry {
  const side = 40;
  const available = paper.widthPoints - side * 2;
  return {
    glyph: paper.glyphWidth,
    side,
    leftWidth: available * 0.65,
    rightWidth: available * 0.35 - 15,
    topWidth: paper.widthPoints - 80,
  };
}

function titleLineAppender(
  block: ScreenplayPreviewBlock,
  geometry: TitleGeometry,
  lines: ScreenplayLayoutLine[],
): (input: TitleLineInput) => void {
  let sequence = 0;
  return (input) => {
    lines.push({
      id: `${block.id}-title-${sequence++}`,
      blockId: block.id,
      kind: 'title-page',
      text: input.text,
      x: input.x,
      baselineY: input.baselineY,
      width: input.width,
      columns: Math.floor(input.width / geometry.glyph),
      align: input.align,
      font: 'regular',
      sourceStart: input.sourceStart,
      sourceEnd: input.sourceEnd,
      ...(input.textSourceOffsets
        ? { textSourceOffsets: Object.freeze([...input.textSourceOffsets]) }
        : {}),
      ...(input.inlineStyles?.length
        ? { inlineStyles: Object.freeze([...input.inlineStyles]) }
        : {}),
    });
  };
}

function appendTopFields(
  fields: readonly ScreenplayPreviewTitleField[],
  block: ScreenplayPreviewBlock,
  paper: ScreenplayPaperSpecification,
  geometry: TitleGeometry,
  addLine: (input: TitleLineInput) => void,
): void {
  let baseline = paper.heightPoints - 290.5;
  let previousKey: string | undefined;
  for (const field of fields) {
    const key = normalizedTitleFieldKey(field.key);
    if (previousKey) baseline -= previousKey === 'title' ? 36 : 12;
    const sourceValue = field.displayValue ?? field.value;
    const value = key === 'title' ? uppercasePreservingLength(sourceValue) : sourceValue;
    const wrapped = wrapTextRanges(value, Math.floor(geometry.topWidth / geometry.glyph));
    for (const line of wrapped) {
      addLine(
        titleLineInput(field, block, line, {
          x: geometry.side + 2.5,
          baselineY: baseline,
          width: geometry.topWidth,
          align: 'center',
        }),
      );
      baseline -= paper.lineHeight;
    }
    previousKey = key;
  }
}

function appendBottomFields(
  fields: readonly ScreenplayPreviewTitleField[],
  block: ScreenplayPreviewBlock,
  paper: ScreenplayPaperSpecification,
  geometry: TitleGeometry,
  addLine: (input: TitleLineInput) => void,
): void {
  const left: BottomTitleLine[] = [];
  const right: BottomTitleLine[] = [];
  for (const field of fields) {
    const target = isDateField(field.key) ? right : left;
    const width = target === right ? geometry.rightWidth : geometry.leftWidth;
    target.push(...bottomFieldLines(field, block, Math.floor(width / geometry.glyph)));
  }
  appendBottomColumn(
    left,
    { x: geometry.side, width: geometry.leftWidth, align: 'left' },
    paper,
    addLine,
  );
  appendBottomColumn(
    right,
    { x: geometry.side + geometry.leftWidth, width: geometry.rightWidth, align: 'right' },
    paper,
    addLine,
  );
}

function bottomFieldLines(
  field: ScreenplayPreviewTitleField,
  block: ScreenplayPreviewBlock,
  columns: number,
): BottomTitleLine[] {
  const value = field.displayValue ?? field.value;
  const fallbackStart = field.textSourceOffsets?.[0] ?? block.sourceStart;
  const fallbackEnd = field.textSourceOffsets?.at(-1) ?? block.sourceEnd;
  return wrapTextRanges(value, columns).map((line) => {
    const offsets = field.textSourceOffsets?.slice(line.from, line.to + 1);
    return {
      text: line.text,
      start: offsets?.[0] ?? fallbackStart,
      end: offsets?.at(-1) ?? fallbackEnd,
      ...(offsets ? { offsets } : {}),
      ...(field.inlineStyles
        ? { styles: sliceInlineStyles(field.inlineStyles, line.from, line.to) }
        : {}),
    };
  });
}

function appendBottomColumn(
  lines: readonly BottomTitleLine[],
  placement: BottomColumnPlacement,
  paper: ScreenplayPaperSpecification,
  addLine: (input: TitleLineInput) => void,
): void {
  lines.forEach((line, index) =>
    addLine({
      text: line.text,
      x: placement.x,
      baselineY: 88.5 + (lines.length - index - 1) * paper.lineHeight,
      width: placement.width,
      align: placement.align,
      sourceStart: line.start,
      sourceEnd: line.end,
      ...(line.offsets ? { textSourceOffsets: line.offsets } : {}),
      ...(line.styles ? { inlineStyles: line.styles } : {}),
    }),
  );
}

function titleLineInput(
  field: ScreenplayPreviewTitleField,
  block: ScreenplayPreviewBlock,
  line: { text: string; from: number; to: number },
  placement: TitleLinePlacement,
): TitleLineInput {
  const offsets = field.textSourceOffsets?.slice(line.from, line.to + 1);
  return {
    text: line.text,
    ...placement,
    sourceStart: offsets?.[0] ?? field.textSourceStart ?? block.sourceStart,
    sourceEnd: offsets?.at(-1) ?? field.textSourceEnd ?? block.sourceEnd,
    ...(offsets ? { textSourceOffsets: offsets } : {}),
    ...(field.inlineStyles
      ? { inlineStyles: sliceInlineStyles(field.inlineStyles, line.from, line.to) }
      : {}),
  };
}

function isTopField(key: string): boolean {
  return ['title', 'credit', 'author', 'authors', 'source'].includes(normalizedTitleFieldKey(key));
}

function isDateField(key: string): boolean {
  return ['draftdate', 'date'].includes(normalizedTitleFieldKey(key));
}

function normalizedTitleFieldKey(key: string): string {
  return key.toLocaleLowerCase().replace(/[^a-z]/gu, '');
}
