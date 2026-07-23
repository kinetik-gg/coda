import type { FountainDocument } from '@coda/fountain';
import type { ScreenplayPaperSize, ScreenplayPaperSpecification } from './screenplay-paper';

export type ScreenplayPreviewBlockKind =
  | 'action'
  | 'centered'
  | 'character'
  | 'dialogue'
  | 'lyric'
  | 'parenthetical'
  | 'scene-heading'
  | 'title-page'
  | 'transition';

export interface ScreenplayPreviewInlineStyle {
  kind: 'bold' | 'bold_italic' | 'italic' | 'underline';
  from: number;
  to: number;
}

export interface ScreenplayPreviewTitleField {
  key: string;
  value: string;
  displayValue?: string;
  textSourceStart?: number;
  textSourceEnd?: number;
  textSourceOffsets?: readonly number[];
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
}

export interface ScreenplayLayoutBlankLine {
  sourceStart: number;
  sourceEnd: number;
}

export interface ScreenplayPreviewBlock {
  id: string;
  kind: ScreenplayPreviewBlockKind;
  text: string;
  displayText?: string;
  sourceStart: number;
  sourceEnd: number;
  textSourceStart?: number;
  textSourceEnd?: number;
  textSourceOffsets?: readonly number[];
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
  lineStart: number;
  lineEnd: number;
  sceneAnchor?: string;
  sceneNumber?: string;
  dual?: boolean;
  dualColumn?: 'left' | 'right';
  layoutBlankLinesBefore?: readonly ScreenplayLayoutBlankLine[];
  layoutBlankLinesAfter?: readonly ScreenplayLayoutBlankLine[];
  layoutLines?: readonly ScreenplayLayoutLine[];
  titleFields?: readonly ScreenplayPreviewTitleField[];
}

export interface ScreenplayLayoutLine {
  id: string;
  blockId: string;
  kind: ScreenplayPreviewBlockKind;
  text: string;
  x: number;
  baselineY: number;
  width: number;
  columns: number;
  align: 'left' | 'center' | 'right';
  font: 'regular' | 'bold' | 'italic' | 'bold-italic';
  sourceStart: number;
  sourceEnd: number;
  textSourceOffsets?: readonly number[];
  inlineStyles?: readonly ScreenplayPreviewInlineStyle[];
  continuation?: 'more' | 'continued';
  dualColumn?: 'left' | 'right';
  sceneNumber?: string;
  revisionMarker?: string;
}

export interface ScreenplaySourceSelection {
  anchor: number;
  head: number;
  from: number;
  to: number;
}

export interface ScreenplayPreviewPage {
  id: string;
  pageNumber: number | null;
  printedPageNumber?: string;
  blocks: readonly ScreenplayPreviewBlock[];
  lines: readonly ScreenplayLayoutLine[];
}

export interface ScreenplaySceneOutlineItem {
  id: string;
  label: string;
  sceneNumber?: string;
  sourceStart: number;
  line: number;
  pageNumber: number;
}

export interface ScreenplayPreviewModel {
  paperSize: ScreenplayPaperSize;
  pages: readonly ScreenplayPreviewPage[];
  scenes: readonly ScreenplaySceneOutlineItem[];
  printableBlocks: readonly ScreenplayPreviewBlock[];
}

export interface ScreenplayPreviewOptions {
  paperSize?: ScreenplayPaperSize;
  linesPerPage?: number;
}

export type LayoutToken =
  | { kind: 'page-break' }
  | { kind: 'block'; block: ScreenplayPreviewBlock }
  | { kind: 'dialogue'; blocks: readonly ScreenplayPreviewBlock[] }
  | {
      kind: 'dual-dialogue';
      left: readonly ScreenplayPreviewBlock[];
      right: readonly ScreenplayPreviewBlock[];
    };

export interface ScreenplaySemanticTokens {
  titleBlock?: ScreenplayPreviewBlock;
  tokens: readonly LayoutToken[];
  printableBlocks: readonly ScreenplayPreviewBlock[];
}

export interface ScreenplayLayoutContext {
  paper: ScreenplayPaperSpecification;
  document: FountainDocument;
  linesPerPage: number;
}

export const SCREENPLAY_BLOCK_SPACING: Readonly<
  Partial<Record<ScreenplayPreviewBlockKind, number>>
> = Object.freeze({
  action: 1,
  centered: 1,
  character: 1,
  lyric: 1,
  'scene-heading': 2,
  transition: 1,
});
