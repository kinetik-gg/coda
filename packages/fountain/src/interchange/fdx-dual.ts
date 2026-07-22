import type { FountainElement } from '../types';

export interface DialogueBranch {
  character: Extract<FountainElement, { kind: 'character' }>;
  start: number;
  end: number;
}

export interface DualDialoguePair {
  first: DialogueBranch;
  second: DialogueBranch;
}

export function dualDialoguePairAt(
  elements: readonly FountainElement[],
  index: number,
): DualDialoguePair | undefined {
  const first = dialogueBranchAt(elements, index);
  if (!first || first.character.dual) return undefined;
  const second = dialogueBranchAt(elements, nextNonSeparator(elements, first.end));
  return second?.character.dual ? { first, second } : undefined;
}

function dialogueBranchAt(
  elements: readonly FountainElement[],
  index: number,
): DialogueBranch | undefined {
  const character = elements[index];
  if (character?.kind !== 'character') return undefined;
  let end = index + 1;
  while (isDialogueElement(elements[end])) end += 1;
  return { character, start: index, end };
}

function isDialogueElement(element: FountainElement | undefined): boolean {
  return (
    element?.kind === 'parenthetical' || element?.kind === 'dialogue' || element?.kind === 'lyric'
  );
}

function nextNonSeparator(elements: readonly FountainElement[], index: number): number {
  let cursor = index;
  while (elements[cursor]?.kind === 'separator') cursor += 1;
  return cursor;
}
