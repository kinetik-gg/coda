import type { FountainAnnotation, FountainDocument, FountainElement } from '@coda/fountain';
import type {
  LayoutToken,
  ScreenplayPreviewBlock,
  ScreenplayPreviewInlineStyle,
  ScreenplaySemanticTokens,
} from './screenplay-preview-types';

type RawLayoutToken = LayoutToken | { kind: 'dual-dialogue-barrier' };
export function semanticTokens(
  document: FountainDocument,
  printAutomaticSceneNumbers = false,
): ScreenplaySemanticTokens {
  const rawTokens: RawLayoutToken[] = [];
  const printableBlocks: ScreenplayPreviewBlock[] = [];
  let titleBlock: ScreenplayPreviewBlock | undefined;
  let sceneSequence = 0;
  let index = 0;
  while (index < document.elements.length) {
    const element = document.elements[index];
    if (!element) {
      index += 1;
      continue;
    }
    if (element.kind === 'title_page') {
      titleBlock = previewBlock(element, sceneSequence, document.annotations);
      if (titleBlock) printableBlocks.push(titleBlock);
      index += 1;
      continue;
    }
    if (element.kind === 'page_break') {
      rawTokens.push({ kind: 'page-break' });
      index += 1;
      continue;
    }
    if (isDualDialogueBarrier(element)) {
      rawTokens.push({ kind: 'dual-dialogue-barrier' });
      index += 1;
      continue;
    }
    const consumed = consumePrintableElement(
      document,
      index,
      sceneSequence,
      printAutomaticSceneNumbers,
    );
    index = consumed.nextIndex;
    sceneSequence = consumed.sceneSequence;
    printableBlocks.push(...consumed.blocks);
    if (consumed.token) rawTokens.push(consumed.token);
  }
  return {
    ...(titleBlock ? { titleBlock } : {}),
    tokens: Object.freeze(combineDualDialogue(rawTokens)),
    printableBlocks,
  };
}

function consumePrintableElement(
  document: FountainDocument,
  index: number,
  sceneSequence: number,
  printAutomaticSceneNumbers: boolean,
): {
  nextIndex: number;
  sceneSequence: number;
  blocks: ScreenplayPreviewBlock[];
  token?: LayoutToken;
} {
  const element = document.elements[index];
  if (!element) return { nextIndex: index + 1, sceneSequence, blocks: [] };
  const block = previewBlock(
    element,
    sceneSequence,
    document.annotations,
    printAutomaticSceneNumbers,
  );
  if (!block) return { nextIndex: index + 1, sceneSequence, blocks: [] };
  const nextSceneSequence = block.kind === 'scene-heading' ? sceneSequence + 1 : sceneSequence;
  if (block.kind !== 'character') {
    return {
      nextIndex: index + 1,
      sceneSequence: nextSceneSequence,
      blocks: [block],
      token: { kind: 'block', block },
    };
  }
  const dialogue = consumeDialogueFollowers(
    document,
    index + 1,
    block,
    nextSceneSequence,
    printAutomaticSceneNumbers,
  );
  return {
    nextIndex: dialogue.nextIndex,
    sceneSequence: nextSceneSequence,
    blocks: dialogue.blocks,
    token: { kind: 'dialogue', blocks: Object.freeze(dialogue.blocks) },
  };
}

function consumeDialogueFollowers(
  document: FountainDocument,
  startIndex: number,
  character: ScreenplayPreviewBlock,
  sceneSequence: number,
  printAutomaticSceneNumbers: boolean,
): { nextIndex: number; blocks: ScreenplayPreviewBlock[] } {
  const blocks = [character];
  let index = startIndex;
  while (index < document.elements.length) {
    const element = document.elements[index];
    if (!element || !isDialogueFollowerElement(element)) break;
    const follower = previewBlock(
      element,
      sceneSequence,
      document.annotations,
      printAutomaticSceneNumbers,
    );
    if (follower) blocks.push(follower);
    index += 1;
  }
  return { nextIndex: index, blocks };
}

function combineDualDialogue(rawTokens: readonly RawLayoutToken[]): LayoutToken[] {
  const tokens: LayoutToken[] = [];
  let previousDialogueCanPair = false;
  for (const token of rawTokens) {
    if (token.kind === 'dual-dialogue-barrier') {
      previousDialogueCanPair = false;
      continue;
    }
    const previous = tokens.at(-1);
    if (
      token.kind === 'dialogue' &&
      token.blocks[0]?.dual &&
      previousDialogueCanPair &&
      previous?.kind === 'dialogue' &&
      !sameDialogueCue(previous.blocks, token.blocks)
    ) {
      tokens.pop();
      tokens.push({ kind: 'dual-dialogue', left: previous.blocks, right: token.blocks });
    } else {
      tokens.push(token);
    }
    previousDialogueCanPair = token.kind === 'dialogue';
  }
  return tokens;
}

function sameDialogueCue(
  left: readonly ScreenplayPreviewBlock[],
  right: readonly ScreenplayPreviewBlock[],
): boolean {
  const cue = (blocks: readonly ScreenplayPreviewBlock[]) =>
    (blocks[0]?.displayText ?? blocks[0]?.text ?? '').trim().toLocaleUpperCase();
  return cue(left) === cue(right);
}

function isDualDialogueBarrier(element: FountainElement): boolean {
  return (
    element.kind === 'section' ||
    element.kind === 'synopsis' ||
    element.kind === 'note' ||
    element.kind === 'boneyard'
  );
}

function isDialogueFollowerElement(element: FountainElement): boolean {
  return (
    element.kind === 'dialogue' || element.kind === 'parenthetical' || element.kind === 'lyric'
  );
}

function previewBlock(
  element: FountainElement,
  sceneSequence: number,
  annotations: readonly FountainAnnotation[],
  printAutomaticSceneNumbers = false,
): ScreenplayPreviewBlock | undefined {
  const common = {
    id: `preview-block-${element.lineStart + 1}-${element.start}`,
    sourceStart: element.start,
    sourceEnd: element.end,
    lineStart: element.lineStart,
    lineEnd: element.lineEnd,
  };
  const withTextSource = (text: string) =>
    formattedTextSourceProperties(element.raw, element.start, text, annotations);
  switch (element.kind) {
    case 'title_page':
      return titlePageBlock(element, common, annotations);
    case 'scene_heading':
      return {
        ...common,
        ...withTextSource(element.text),
        kind: 'scene-heading',
        text: element.text,
        sceneAnchor: `scene-${sceneSequence + 1}-${slug(element.text)}`,
        ...(element.sceneNumber
          ? { sceneNumber: element.sceneNumber }
          : printAutomaticSceneNumbers
            ? { sceneNumber: String(sceneSequence + 1) }
            : {}),
      };
    case 'action':
      return { ...common, ...withTextSource(element.text), kind: 'action', text: element.text };
    case 'character': {
      const text = `${element.name}${element.extension ? ` ${element.extension}` : ''}`;
      return { ...common, ...withTextSource(text), kind: 'character', text, dual: element.dual };
    }
    case 'dialogue':
      return {
        ...common,
        ...formattedTextSourceProperties(
          element.raw,
          element.start,
          element.text,
          annotations,
          'all',
        ),
        kind: 'dialogue',
        text: element.text,
      };
    case 'parenthetical':
      return {
        ...common,
        ...withTextSource(element.text),
        kind: 'parenthetical',
        text: element.text,
      };
    case 'lyric':
      return { ...common, ...withTextSource(element.text), kind: 'lyric', text: element.text };
    case 'transition':
      return { ...common, ...withTextSource(element.text), kind: 'transition', text: element.text };
    case 'centered':
      return { ...common, ...withTextSource(element.text), kind: 'centered', text: element.text };
    case 'boneyard':
    case 'note':
    case 'page_break':
    case 'section':
    case 'separator':
    case 'synopsis':
      return undefined;
  }
}

function titlePageBlock(
  element: Extract<FountainElement, { kind: 'title_page' }>,
  common: Pick<
    ScreenplayPreviewBlock,
    'id' | 'sourceStart' | 'sourceEnd' | 'lineStart' | 'lineEnd'
  >,
  annotations: readonly FountainAnnotation[],
): ScreenplayPreviewBlock {
  return {
    ...common,
    kind: 'title-page',
    text: element.fields
      .map((field) => field.value)
      .filter(Boolean)
      .join('\n'),
    titleFields: element.fields.map((field) => {
      const formatted = formattedTextSourceProperties(
        field.raw,
        field.start,
        field.value,
        annotations,
        'fixed',
      );
      return {
        key: field.key,
        value: field.value,
        ...('displayText' in formatted && typeof formatted.displayText === 'string'
          ? { displayValue: formatted.displayText }
          : {}),
        ...formatted,
      };
    }),
  };
}

function textSourceProperties(
  raw: string,
  sourceStart: number,
  text: string,
  skipContinuationIndent: false | 'fixed' | 'all' = false,
  hidden: readonly FountainAnnotation[] = [],
) {
  const offsets = matchTextSourceOffsets(raw, sourceStart, text, skipContinuationIndent, hidden);
  return offsets
    ? { textSourceStart: offsets[0], textSourceEnd: offsets.at(-1), textSourceOffsets: offsets }
    : {};
}

function formattedTextSourceProperties(
  raw: string,
  sourceStart: number,
  text: string,
  annotations: readonly FountainAnnotation[],
  skipContinuationIndent: false | 'fixed' | 'all' = false,
) {
  const localAnnotations = annotations.filter(
    (annotation) => annotation.start >= sourceStart && annotation.end <= sourceStart + raw.length,
  );
  const emphasis = localAnnotations.filter((annotation) =>
    ['bold', 'bold_italic', 'italic', 'underline'].includes(annotation.kind),
  );
  const hidden = localAnnotations.filter(
    (annotation) => annotation.kind === 'note' || annotation.kind === 'boneyard',
  );
  const base = textSourceProperties(raw, sourceStart, text, skipContinuationIndent, hidden);
  const sourceOffsets = base.textSourceOffsets;
  if (!sourceOffsets) return base;
  return formattedProperties(text, sourceOffsets, emphasis, hidden);
}

function formattedProperties(
  text: string,
  sourceOffsets: readonly number[],
  emphasis: readonly FountainAnnotation[],
  hidden: readonly FountainAnnotation[],
) {
  const markerRanges = emphasis.flatMap((annotation) => [
    { start: annotation.start, end: annotation.contentStart },
    { start: annotation.contentEnd, end: annotation.end },
  ]);
  const keptIndices = Array.from({ length: text.length }, (_, index) => index).filter((index) => {
    const offset = sourceOffsets[index];
    return (
      offset !== undefined &&
      !markerRanges.some((range) => offset >= range.start && offset < range.end) &&
      !hidden.some((range) => offset >= range.start && offset < range.end)
    );
  });
  const printable = normalizedPrintableText(text, keptIndices);
  if (printable.text === text && keptIndices.length === text.length) {
    return {
      textSourceStart: sourceOffsets[0],
      textSourceEnd: sourceOffsets.at(-1),
      textSourceOffsets: sourceOffsets,
    };
  }
  const displayOffsets = displaySourceOffsets(printable.sourceIndices, sourceOffsets);
  return {
    displayText: printable.text,
    textSourceStart: displayOffsets[0],
    textSourceEnd: displayOffsets.at(-1),
    textSourceOffsets: displayOffsets,
    inlineStyles: inlineStyles(printable.sourceIndices, sourceOffsets, emphasis),
  };
}

function normalizedPrintableText(
  text: string,
  keptIndices: readonly number[],
): { text: string; sourceIndices: readonly number[] } {
  const sourceIndices: number[] = [];
  let pendingSpace: number | undefined;
  for (const index of keptIndices) {
    const character = text[index];
    if (character === ' ' || character === '\t') {
      if (sourceIndices.length && text[sourceIndices.at(-1)!] !== '\n') pendingSpace ??= index;
      continue;
    }
    if (character === '\n') {
      pendingSpace = undefined;
      sourceIndices.push(index);
      continue;
    }
    if (pendingSpace !== undefined) sourceIndices.push(pendingSpace);
    pendingSpace = undefined;
    sourceIndices.push(index);
  }
  return {
    text: sourceIndices
      .map((index) => (text[index] === ' ' || text[index] === '\t' ? ' ' : text[index]))
      .join(''),
    sourceIndices,
  };
}

function displaySourceOffsets(
  indices: readonly number[],
  sourceOffsets: readonly number[],
): number[] {
  const result: number[] = [];
  for (const index of indices) {
    const start = sourceOffsets[index];
    const end = sourceOffsets[index + 1];
    if (start === undefined || end === undefined) continue;
    if (!result.length) result.push(start);
    else result[result.length - 1] = start;
    result.push(end);
  }
  return result;
}

function inlineStyles(
  indices: readonly number[],
  sourceOffsets: readonly number[],
  annotations: readonly FountainAnnotation[],
): ScreenplayPreviewInlineStyle[] {
  return annotations.flatMap((annotation) => {
    const styled = indices.flatMap((sourceIndex, displayIndex) => {
      const offset = sourceOffsets[sourceIndex];
      return offset !== undefined &&
        offset >= annotation.contentStart &&
        offset < annotation.contentEnd
        ? [displayIndex]
        : [];
    });
    const first = styled[0];
    const last = styled.at(-1);
    return first === undefined || last === undefined
      ? []
      : [{ kind: annotation.kind, from: first, to: last + 1 } as ScreenplayPreviewInlineStyle];
  });
}

function matchTextSourceOffsets(
  raw: string,
  sourceStart: number,
  text: string,
  skipContinuationIndent: false | 'fixed' | 'all',
  hidden: readonly FountainAnnotation[],
): readonly number[] | undefined {
  if (!text.length) return undefined;
  for (let candidate = 0; candidate < raw.length; candidate += 1) {
    if (raw[candidate] !== text[0]) continue;
    const offsets = matchTextFromCandidate(raw, sourceStart, text, {
      candidate,
      skipContinuationIndent,
      hidden,
    });
    if (offsets) return offsets;
  }
  return undefined;
}

function matchTextFromCandidate(
  raw: string,
  sourceStart: number,
  text: string,
  options: {
    candidate: number;
    skipContinuationIndent: false | 'fixed' | 'all';
    hidden: readonly FountainAnnotation[];
  },
) {
  const { candidate, hidden, skipContinuationIndent } = options;
  const offsets = [sourceStart + candidate];
  let sourceIndex = candidate;
  for (const character of text) {
    sourceIndex = skipHiddenAnnotations(sourceIndex, sourceStart, hidden);
    const boundary = offsets[offsets.length - 1];
    if (character !== '\n' || boundary === sourceStart + sourceIndex) {
      offsets[offsets.length - 1] = sourceStart + sourceIndex;
    }
    const nextIndex = matchingCharacterEnd(raw, sourceIndex, character);
    if (nextIndex === undefined) return undefined;
    sourceIndex =
      character === '\n'
        ? continuationContentStart(raw, nextIndex, skipContinuationIndent)
        : nextIndex;
    offsets.push(sourceStart + (character === '\n' ? nextIndex : sourceIndex));
  }
  return offsets;
}

function skipHiddenAnnotations(
  sourceIndex: number,
  sourceStart: number,
  hidden: readonly FountainAnnotation[],
): number {
  let absolute = sourceStart + sourceIndex;
  for (const annotation of hidden) {
    if (annotation.start > absolute) break;
    if (annotation.end > absolute) absolute = annotation.end;
  }
  return absolute - sourceStart;
}

function matchingCharacterEnd(raw: string, sourceIndex: number, character: string) {
  if (character === '\n' && raw[sourceIndex] === '\r' && raw[sourceIndex + 1] === '\n') {
    return sourceIndex + 2;
  }
  return raw[sourceIndex] === character ? sourceIndex + 1 : undefined;
}

function continuationContentStart(raw: string, sourceIndex: number, mode: false | 'fixed' | 'all') {
  if (mode === 'all') {
    let cursor = sourceIndex;
    while (raw[cursor] === ' ' || raw[cursor] === '\t') cursor += 1;
    return cursor;
  }
  if (mode !== 'fixed') return sourceIndex;
  if (raw[sourceIndex] === '\t') return sourceIndex + 1;
  return raw.slice(sourceIndex, sourceIndex + 3) === '   ' ? sourceIndex + 3 : sourceIndex;
}

function slug(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'untitled'
  );
}
