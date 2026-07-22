import { fountainRevisionMarker, type FountainRevisionRange } from '@coda/fountain';
import {
  continuationDraft,
  dialogueDrafts,
  lineFont,
  linePlacement,
  wrapBlock,
  type LayoutLineDraft,
} from './screenplay-layout-text';
import type {
  LayoutToken,
  ScreenplayLayoutContext,
  ScreenplayLayoutLine,
  ScreenplayPreviewBlock,
  ScreenplayPreviewPage,
} from './screenplay-preview-types';
import { SCREENPLAY_BLOCK_SPACING } from './screenplay-preview-types';

interface MutableLayoutPage {
  pageNumber: number;
  blocks: ScreenplayPreviewBlock[];
  lines: ScreenplayLayoutLine[];
  usedRows: number;
}

interface PaginationState {
  context: ScreenplayLayoutContext;
  observer?: ScreenplayPaginationObserver;
  pages: ScreenplayPreviewPage[];
  page: MutableLayoutPage;
}

export interface ScreenplayPaginationObserver {
  beforeLine?: (line: ScreenplayLayoutLine) => void;
  beforePage?: (pageNumber: number) => void;
}

export function paginateTokens(
  tokens: readonly LayoutToken[],
  context: ScreenplayLayoutContext,
  observer?: ScreenplayPaginationObserver,
): ScreenplayPreviewPage[] {
  const state: PaginationState = { context, observer, pages: [], page: newMutablePage(1) };
  tokens.forEach((token, index) => placeToken(token, tokens[index + 1], state));
  if (shouldFinishLastPage(tokens, state)) finishPage(state, true);
  return state.pages;
}

function placeToken(
  token: LayoutToken,
  following: LayoutToken | undefined,
  state: PaginationState,
): void {
  if (token.kind === 'page-break') {
    finishPage(state, true);
    return;
  }
  if (token.kind === 'block') {
    protectHeading(token, following, state);
    placeBlockAcrossPages(token.block, state);
    return;
  }
  if (token.kind === 'dialogue') {
    placeDialogueAcrossPages(token.blocks, state);
    return;
  }
  placeDualDialogueAcrossPages(token.left, token.right, state);
}

function protectHeading(
  token: Extract<LayoutToken, { kind: 'block' }>,
  following: LayoutToken | undefined,
  state: PaginationState,
): void {
  if (token.block.kind !== 'scene-heading' || !state.page.lines.length) return;
  if (remainingRows(state) < minimumGroupedRows(token, following, state)) finishPage(state);
}

function minimumGroupedRows(
  heading: Extract<LayoutToken, { kind: 'block' }>,
  following: LayoutToken | undefined,
  state: PaginationState,
): number {
  const paper = state.context.paper;
  const headingRows =
    wrapBlock(heading.block, paper).length + SCREENPLAY_BLOCK_SPACING['scene-heading']!;
  if (!following || following.kind === 'page-break') return Math.max(5, headingRows);
  return headingRows + Math.min(3, tokenRows(following, paper));
}

function tokenRows(
  token: Exclude<LayoutToken, { kind: 'page-break' }>,
  paper: ScreenplayLayoutContext['paper'],
): number {
  if (token.kind === 'block') {
    return wrapBlock(token.block, paper).length + (SCREENPLAY_BLOCK_SPACING[token.block.kind] ?? 0);
  }
  if (token.kind === 'dialogue') return dialogueDrafts(token.blocks, paper).length + 1;
  return (
    Math.max(
      dialogueDrafts(token.left, paper, 'left').length,
      dialogueDrafts(token.right, paper, 'right').length,
    ) + 1
  );
}

function placeBlockAcrossPages(block: ScreenplayPreviewBlock, state: PaginationState): void {
  const drafts = wrapBlock(block, state.context.paper);
  let spacing = state.page.lines.length ? (SCREENPLAY_BLOCK_SPACING[block.kind] ?? 0) : 0;
  if (blockStartsNextPage(spacing, drafts.length, state)) {
    finishPage(state);
    spacing = 0;
  }
  state.page.usedRows += spacing;
  let cursor = 0;
  while (cursor < drafts.length) cursor = placeBlockChunk(drafts, cursor, state);
}

function blockStartsNextPage(spacing: number, draftCount: number, state: PaginationState): boolean {
  const required = spacing + draftCount;
  const remaining = remainingRows(state);
  return (
    Boolean(state.page.lines.length) &&
    required > remaining &&
    (required <= state.context.linesPerPage || remaining < 2)
  );
}

function placeBlockChunk(
  drafts: readonly LayoutLineDraft[],
  cursor: number,
  state: PaginationState,
): number {
  if (remainingRows(state) <= 0) finishPage(state);
  const available = remainingRows(state);
  const remaining = drafts.length - cursor;
  const take =
    remaining > available && remaining - available === 1 && available > 1
      ? available - 1
      : Math.min(available, remaining);
  for (let count = 0; count < take; count += 1) placeDraft(drafts[cursor + count]!, state);
  const nextCursor = cursor + take;
  if (nextCursor < drafts.length) finishPage(state);
  return nextCursor;
}

function placeDialogueAcrossPages(
  blocks: readonly ScreenplayPreviewBlock[],
  state: PaginationState,
): void {
  const drafts = [...dialogueDrafts(blocks, state.context.paper)];
  if (!drafts.length) return;
  prepareDialoguePage(drafts, state);
  const cue = drafts[0]!;
  let cursor = 0;
  let continued = false;
  while (cursor < drafts.length) {
    if (continued) placeContinuedCue(cue, state);
    const result = placeDialogueChunk(drafts, cursor, cue, state);
    cursor = result.cursor;
    continued = result.continued;
  }
}

function prepareDialoguePage(drafts: readonly LayoutLineDraft[], state: PaginationState): void {
  const spacing = state.page.lines.length ? 1 : 0;
  const remaining = remainingRows(state);
  const shouldMove =
    state.page.lines.length &&
    spacing + drafts.length > remaining &&
    (drafts.length <= state.context.linesPerPage ||
      remaining < spacing + minimumDialogueSplitRows(drafts));
  if (shouldMove) finishPage(state);
  else state.page.usedRows += spacing;
}

function placeContinuedCue(cue: LayoutLineDraft, state: PaginationState): void {
  if (remainingRows(state) < 2) finishPage(state);
  placeDraft(continuationDraft(cue, 'continued'), state);
}

function placeDialogueChunk(
  drafts: readonly LayoutLineDraft[],
  cursor: number,
  cue: LayoutLineDraft,
  state: PaginationState,
): { cursor: number; continued: boolean } {
  let available = remainingRows(state);
  const remaining = drafts.length - cursor;
  if (remaining <= available) {
    for (let index = cursor; index < drafts.length; index += 1) placeDraft(drafts[index]!, state);
    return { cursor: drafts.length, continued: false };
  }
  if (available < 2) {
    finishPage(state);
    return { cursor, continued: cursor > 0 };
  }
  available -= 1;
  const take = Math.max(1, available);
  for (let count = 0; count < take && cursor + count < drafts.length; count += 1) {
    placeDraft(drafts[cursor + count]!, state);
  }
  const nextCursor = Math.min(cursor + take, drafts.length);
  placeDraft(continuationDraft(cue, 'more'), state);
  finishPage(state);
  return { cursor: nextCursor, continued: true };
}

function placeDualDialogueAcrossPages(
  leftBlocks: readonly ScreenplayPreviewBlock[],
  rightBlocks: readonly ScreenplayPreviewBlock[],
  state: PaginationState,
): void {
  const left = [...dialogueDrafts(leftBlocks, state.context.paper, 'left')];
  const right = [...dialogueDrafts(rightBlocks, state.context.paper, 'right')];
  const cues = { left: left[0], right: right[0] };
  prepareDualPage(left, right, state);
  let continued = false;
  while (left.length || right.length) {
    if (continued) prependContinuedCues(left, right, cues);
    if (needsFreshDualPage(left, right, state)) {
      finishPage(state);
      continued = true;
      continue;
    }
    placeDualChunk(left, right, cues, state);
    if (left.length || right.length) {
      finishPage(state);
      continued = true;
    }
  }
}

function prepareDualPage(
  left: readonly LayoutLineDraft[],
  right: readonly LayoutLineDraft[],
  state: PaginationState,
): void {
  const spacing = state.page.lines.length ? 1 : 0;
  const rowCount = Math.max(left.length, right.length);
  const minimum = Math.max(minimumDialogueSplitRows(left), minimumDialogueSplitRows(right));
  const remaining = remainingRows(state);
  const shouldMove =
    state.page.lines.length &&
    spacing + rowCount > remaining &&
    (rowCount <= state.context.linesPerPage || remaining < spacing + minimum);
  if (shouldMove) finishPage(state);
  else state.page.usedRows += spacing;
}

function prependContinuedCues(
  left: LayoutLineDraft[],
  right: LayoutLineDraft[],
  cues: { left?: LayoutLineDraft; right?: LayoutLineDraft },
): void {
  if (left.length && cues.left) left.unshift(continuationDraft(cues.left, 'continued'));
  if (right.length && cues.right) right.unshift(continuationDraft(cues.right, 'continued'));
}

function needsFreshDualPage(
  left: readonly LayoutLineDraft[],
  right: readonly LayoutLineDraft[],
  state: PaginationState,
): boolean {
  return Math.max(left.length, right.length) > remainingRows(state) && remainingRows(state) < 2;
}

function placeDualChunk(
  left: LayoutLineDraft[],
  right: LayoutLineDraft[],
  cues: { left?: LayoutLineDraft; right?: LayoutLineDraft },
  state: PaginationState,
): void {
  const rows = Math.max(left.length, right.length);
  const available = remainingRows(state);
  const take = rows > available ? available - 1 : rows;
  for (let row = 0; row < take; row += 1) placeDualRow(left.shift(), right.shift(), state);
  if (!left.length && !right.length) return;
  if (remainingRows(state) > 0) {
    placeDualRow(
      left.length && cues.left ? continuationDraft(cues.left, 'more') : undefined,
      right.length && cues.right ? continuationDraft(cues.right, 'more') : undefined,
      state,
    );
  }
}

function minimumDialogueSplitRows(drafts: readonly LayoutLineDraft[]): number {
  const firstSpokenLine = drafts.findIndex(
    (draft) => draft.block.kind === 'dialogue' || draft.block.kind === 'lyric',
  );
  return (firstSpokenLine < 0 ? Math.min(2, drafts.length) : firstSpokenLine + 1) + 1;
}

function placeDualRow(
  left: LayoutLineDraft | undefined,
  right: LayoutLineDraft | undefined,
  state: PaginationState,
): void {
  if (left) placeDraftAtRow(left, state, state.page.usedRows, 'left');
  if (right) placeDraftAtRow(right, state, state.page.usedRows, 'right');
  state.page.usedRows += 1;
}

function placeDraft(draft: LayoutLineDraft, state: PaginationState): void {
  placeDraftAtRow(draft, state, state.page.usedRows);
  state.page.usedRows += 1;
}

function placeDraftAtRow(
  draft: LayoutLineDraft,
  state: PaginationState,
  row: number,
  dualColumn?: 'left' | 'right',
): void {
  const { paper, document } = state.context;
  const placement = linePlacement(draft.block.kind, paper, dualColumn);
  const indented = Boolean(draft.continuationIndent);
  const sourceOffsets = draft.textSourceOffsets
    ? Object.freeze([...draft.textSourceOffsets])
    : undefined;
  const revisionMarker = revisionMarkerFor(
    draft.sourceStart,
    draft.sourceEnd,
    document.revisionMetadata?.ranges ?? [],
  );
  const line: ScreenplayLayoutLine = {
    id: `${draft.block.id}-p${state.page.pageNumber}-r${row}-${dualColumn ?? 'single'}`,
    blockId: draft.block.id,
    kind: draft.block.kind,
    text: draft.text,
    x: placement.x + (indented ? paper.glyphWidth : 0),
    baselineY: bodyBaseline(state.page.pageNumber, paper) - row * paper.lineHeight,
    width: (placement.columns - (indented ? 1 : 0)) * paper.glyphWidth,
    columns: placement.columns - (indented ? 1 : 0),
    align: placement.align,
    font: lineFont(draft.block.kind),
    sourceStart: draft.sourceStart,
    sourceEnd: draft.sourceEnd,
    ...(sourceOffsets ? { textSourceOffsets: sourceOffsets } : {}),
    ...(draft.inlineStyles ? { inlineStyles: Object.freeze([...draft.inlineStyles]) } : {}),
    ...(draft.continuation ? { continuation: draft.continuation } : {}),
    ...(dualColumn ? { dualColumn } : {}),
    ...(draft.block.kind === 'scene-heading' && draft.block.sceneNumber
      ? { sceneNumber: draft.block.sceneNumber }
      : {}),
    ...(revisionMarker ? { revisionMarker } : {}),
  };
  state.observer?.beforeLine?.(line);
  state.page.lines.push(line);
  if (!state.page.blocks.includes(draft.block)) state.page.blocks.push(draft.block);
}

function bodyBaseline(pageNumber: number, paper: ScreenplayLayoutContext['paper']): number {
  return pageNumber === 1 ? paper.firstBodyBaseline : paper.subsequentBodyBaseline;
}

function revisionMarkerFor(
  start: number,
  end: number,
  ranges: readonly FountainRevisionRange[],
): string | undefined {
  const range = ranges
    .filter((candidate) => candidate.start < end && candidate.end > start)
    .sort((left, right) => right.generation - left.generation)[0];
  return range ? fountainRevisionMarker(range.generation) : undefined;
}

function remainingRows(state: PaginationState): number {
  return state.context.linesPerPage - state.page.usedRows;
}

function finishPage(state: PaginationState, force = false): void {
  if (!force && !state.page.lines.length) return;
  state.observer?.beforePage?.(state.page.pageNumber);
  state.pages.push(freezeBodyPage(state.page));
  state.page = newMutablePage(state.page.pageNumber + 1);
}

function newMutablePage(pageNumber: number): MutableLayoutPage {
  return { pageNumber, blocks: [], lines: [], usedRows: 0 };
}

function freezeBodyPage(page: MutableLayoutPage): ScreenplayPreviewPage {
  return Object.freeze({
    id: `preview-page-${page.pageNumber}`,
    pageNumber: page.pageNumber,
    blocks: Object.freeze([...page.blocks]),
    lines: Object.freeze(page.lines.map((line) => Object.freeze(line))),
  });
}

function shouldFinishLastPage(tokens: readonly LayoutToken[], state: PaginationState): boolean {
  return Boolean(
    state.page.lines.length || state.pages.length === 0 || tokens.at(-1)?.kind === 'page-break',
  );
}
