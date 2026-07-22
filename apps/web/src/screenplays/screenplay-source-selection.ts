import type { ScreenplaySourceSelection } from './screenplay-preview-model';

export function clampScreenplaySourceOffset(offset: number, documentLength: number): number {
  return Math.min(Math.max(0, offset), Math.max(0, documentLength));
}

export function clampScreenplaySourceSelection(
  selection: ScreenplaySourceSelection,
  documentLength: number,
): ScreenplaySourceSelection {
  const anchor = clampScreenplaySourceOffset(selection.anchor, documentLength);
  const head = clampScreenplaySourceOffset(selection.head, documentLength);
  return { anchor, head, from: Math.min(anchor, head), to: Math.max(anchor, head) };
}
