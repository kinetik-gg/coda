import { parseFountain, type FountainAnnotation } from '@coda/fountain';
import { paginateTokens } from './screenplay-layout-engine';
import { semanticTokens } from './screenplay-preview-blocks';
import { chunkScreenplayGraphemes, screenplayGraphemeCount } from './screenplay-graphemes';
import {
  SCREENPLAY_BLOCK_SPACING,
  type ScreenplayPreviewBlock,
  type ScreenplayPreviewBlockKind,
  type ScreenplayPreviewModel,
  type ScreenplayPreviewOptions,
  type ScreenplayPreviewPage,
  type ScreenplaySceneOutlineItem,
} from './screenplay-preview-types';
import { layoutTitlePage } from './screenplay-title-layout';
import { screenplayPaper, type ScreenplayPaperSpecification } from './screenplay-paper';

export type {
  ScreenplayLayoutLine,
  ScreenplayPreviewBlock,
  ScreenplayPreviewBlockKind,
  ScreenplayPreviewInlineStyle,
  ScreenplayPreviewModel,
  ScreenplayPreviewOptions,
  ScreenplayPreviewPage,
  ScreenplaySceneOutlineItem,
  ScreenplaySourceSelection,
} from './screenplay-preview-types';

export function buildScreenplayPreview(
  source: string,
  options: ScreenplayPreviewOptions = {},
): ScreenplayPreviewModel {
  const paperSize = options.paperSize ?? 'letter';
  const paper = screenplayPaper(paperSize);
  const linesPerPage = Math.max(10, options.linesPerPage ?? paper.linesPerPage);
  const document = parseFountain(source);
  const semantic = semanticTokens(document);
  const bodyPages = applyCustomPageNumbers(
    paginateTokens(semantic.tokens, { paper, document, linesPerPage }),
    document.annotations,
    source,
  );
  const pages = semantic.titleBlock
    ? [layoutTitlePage(semantic.titleBlock, paper), ...bodyPages]
    : bodyPages;
  return Object.freeze({
    paperSize,
    pages: Object.freeze(pages),
    scenes: Object.freeze(sceneOutline(semantic.printableBlocks, bodyPages)),
    printableBlocks: Object.freeze(semantic.printableBlocks),
  });
}

function sceneOutline(
  blocks: readonly ScreenplayPreviewBlock[],
  pages: readonly ScreenplayPreviewPage[],
): ScreenplaySceneOutlineItem[] {
  return blocks.flatMap((block) => {
    if (block.kind !== 'scene-heading' || !block.sceneAnchor) return [];
    const page = pages.find((candidate) =>
      candidate.lines.some((line) => line.blockId === block.id),
    );
    if (!page?.pageNumber) return [];
    return [
      {
        id: block.sceneAnchor,
        label: block.text,
        sceneNumber: block.sceneNumber,
        sourceStart: block.sourceStart,
        line: block.lineStart + 1,
        pageNumber: page.pageNumber,
      },
    ];
  });
}

function applyCustomPageNumbers(
  pages: readonly ScreenplayPreviewPage[],
  annotations: readonly FountainAnnotation[],
  source: string,
): ScreenplayPreviewPage[] {
  const customNumbers = customPageNumbers(annotations, source);
  if (!customNumbers.length) return [...pages];
  const numbersByPage = new Map<string, string>();
  for (const custom of customNumbers) {
    const page = pageForCustomNumber(pages, custom.offset);
    if (page) numbersByPage.set(page.id, custom.value);
  }
  return pages.map((page) => {
    const printedPageNumber = numbersByPage.get(page.id);
    return printedPageNumber ? Object.freeze({ ...page, printedPageNumber }) : page;
  });
}

function customPageNumbers(
  annotations: readonly FountainAnnotation[],
  source: string,
): Array<{ offset: number; value: string }> {
  return annotations.flatMap((annotation) => {
    if (annotation.kind !== 'note') return [];
    const content = source.slice(annotation.contentStart, annotation.contentEnd).trim();
    const value = /^page\s+(.+)$/iu.exec(content)?.[1]?.trim();
    return value ? [{ offset: annotation.start, value }] : [];
  });
}

function pageForCustomNumber(
  pages: readonly ScreenplayPreviewPage[],
  offset: number,
): ScreenplayPreviewPage | undefined {
  const exact = pages.find((page) =>
    page.blocks.some((block) => offset >= block.sourceStart && offset <= block.sourceEnd),
  );
  const following = pages.find((page) => page.blocks.some((block) => block.sourceStart >= offset));
  return exact ?? following ?? pages.at(-1);
}

export function findPreviewBlockAtOffset(
  model: ScreenplayPreviewModel,
  sourceOffset: number,
): ScreenplayPreviewBlock | undefined {
  const blocks = model.printableBlocks;
  if (!blocks.length) return undefined;
  const containing = blocks.find(
    (block) => sourceOffset >= block.sourceStart && sourceOffset < block.sourceEnd,
  );
  if (containing) return containing;
  return [...blocks].reverse().find((block) => block.sourceStart <= sourceOffset) ?? blocks[0];
}

export function screenplayBlockColumns(
  block: ScreenplayPreviewBlock,
  paper: ScreenplayPaperSpecification,
): number {
  switch (block.kind) {
    case 'action':
    case 'centered':
    case 'transition':
    case 'title-page':
      return paper.actionColumns;
    case 'scene-heading':
      return paper.sceneHeadingColumns;
    case 'character':
      return paper.characterColumns;
    case 'dialogue':
    case 'lyric':
      return paper.dialogueColumns;
    case 'parenthetical':
      return paper.parentheticalColumns;
  }
}

export function screenplayBlockSpacingBefore(kind: ScreenplayPreviewBlockKind): number {
  return SCREENPLAY_BLOCK_SPACING[kind] ?? 0;
}

export function wrapScreenplayText(text: string, columns: number): string[] {
  return text.split('\n').flatMap((paragraph) => wrapScreenplayParagraph(paragraph, columns));
}

function wrapScreenplayParagraph(paragraph: string, columns: number): string[] {
  const words = paragraph.trimEnd().split(/\s+/u).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const piece of chunkScreenplayGraphemes(word, columns)) {
      if (!line) line = piece;
      else if (screenplayGraphemeCount(line) + 1 + screenplayGraphemeCount(piece) <= columns)
        line += ` ${piece}`;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}
