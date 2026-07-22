import type { FountainAnnotation, FountainDocument, FountainElement } from '@coda/fountain';
import type {
  LayoutToken,
  ScreenplayPreviewBlock,
  ScreenplayPreviewInlineStyle,
  ScreenplaySemanticTokens,
} from './screenplay-preview-types';

export function semanticTokens(document: FountainDocument): ScreenplaySemanticTokens {
  const rawTokens: LayoutToken[] = [];
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
    const consumed = consumePrintableElement(document, index, sceneSequence);
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
): {
  nextIndex: number;
  sceneSequence: number;
  blocks: ScreenplayPreviewBlock[];
  token?: LayoutToken;
} {
  const element = document.elements[index];
  if (!element) return { nextIndex: index + 1, sceneSequence, blocks: [] };
  const block = previewBlock(element, sceneSequence, document.annotations);
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
  const dialogue = consumeDialogueFollowers(document, index + 1, block, nextSceneSequence);
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
): { nextIndex: number; blocks: ScreenplayPreviewBlock[] } {
  const blocks = [character];
  let index = startIndex;
  while (index < document.elements.length) {
    const element = document.elements[index];
    if (!element || !isDialogueFollowerElement(element)) break;
    const follower = previewBlock(element, sceneSequence, document.annotations);
    if (follower) blocks.push(follower);
    index += 1;
  }
  return { nextIndex: index, blocks };
}

function combineDualDialogue(rawTokens: readonly LayoutToken[]): LayoutToken[] {
  const tokens: LayoutToken[] = [];
  for (const token of rawTokens) {
    const previous = tokens.at(-1);
    if (token.kind === 'dialogue' && token.blocks[0]?.dual && previous?.kind === 'dialogue') {
      tokens.pop();
      tokens.push({ kind: 'dual-dialogue', left: previous.blocks, right: token.blocks });
    } else {
      tokens.push(token);
    }
  }
  return tokens;
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
        sceneNumber: element.sceneNumber ?? String(sceneSequence + 1),
      };
    case 'action':
      return { ...common, ...withTextSource(element.text), kind: 'action', text: element.text };
    case 'character': {
      const text = `${element.name}${element.extension ? ` ${element.extension}` : ''}`;
      return { ...common, ...withTextSource(text), kind: 'character', text, dual: element.dual };
    }
    case 'dialogue':
      return { ...common, ...withTextSource(element.text), kind: 'dialogue', text: element.text };
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
        true,
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
  skipContinuationIndent = false,
) {
  const offsets = matchTextSourceOffsets(raw, sourceStart, text, skipContinuationIndent);
  return offsets
    ? { textSourceStart: offsets[0], textSourceEnd: offsets.at(-1), textSourceOffsets: offsets }
    : {};
}

function formattedTextSourceProperties(
  raw: string,
  sourceStart: number,
  text: string,
  annotations: readonly FountainAnnotation[],
  skipContinuationIndent = false,
) {
  const base = textSourceProperties(raw, sourceStart, text, skipContinuationIndent);
  const sourceOffsets = base.textSourceOffsets;
  if (!sourceOffsets) return base;
  const localAnnotations = annotations.filter(
    (annotation) => annotation.start >= sourceStart && annotation.end <= sourceStart + raw.length,
  );
  const emphasis = localAnnotations.filter((annotation) =>
    ['bold', 'bold_italic', 'italic', 'underline'].includes(annotation.kind),
  );
  const hidden = localAnnotations.filter(
    (annotation) => annotation.kind === 'note' || annotation.kind === 'boneyard',
  );
  if (!emphasis.length && !hidden.length) return base;
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
  const keptIndices = Array.from(text, (_, index) => index).filter((index) => {
    const offset = sourceOffsets[index];
    return (
      offset !== undefined &&
      !markerRanges.some((range) => offset >= range.start && offset < range.end) &&
      !hidden.some((range) => offset >= range.start && offset < range.end)
    );
  });
  if (keptIndices.length === text.length) {
    return {
      textSourceStart: sourceOffsets[0],
      textSourceEnd: sourceOffsets.at(-1),
      textSourceOffsets: sourceOffsets,
    };
  }
  const displayOffsets = displaySourceOffsets(keptIndices, sourceOffsets);
  return {
    displayText: keptIndices.map((index) => text[index]).join(''),
    textSourceStart: displayOffsets[0],
    textSourceEnd: displayOffsets.at(-1),
    textSourceOffsets: displayOffsets,
    inlineStyles: inlineStyles(keptIndices, sourceOffsets, emphasis),
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
  skipContinuationIndent: boolean,
): readonly number[] | undefined {
  if (!text.length) return undefined;
  for (let candidate = 0; candidate < raw.length; candidate += 1) {
    if (raw[candidate] !== text[0]) continue;
    const offsets = matchTextFromCandidate(
      raw,
      sourceStart,
      text,
      candidate,
      skipContinuationIndent,
    );
    if (offsets) return offsets;
  }
  return undefined;
}

function matchTextFromCandidate(
  raw: string,
  sourceStart: number,
  text: string,
  candidate: number,
  skipContinuationIndent: boolean,
) {
  const offsets = [sourceStart + candidate];
  let sourceIndex = candidate;
  for (const character of text) {
    const nextIndex = matchingCharacterEnd(raw, sourceIndex, character);
    if (nextIndex === undefined) return undefined;
    sourceIndex =
      character === '\n' && skipContinuationIndent
        ? continuationContentStart(raw, nextIndex)
        : nextIndex;
    offsets.push(sourceStart + sourceIndex);
  }
  return offsets;
}

function matchingCharacterEnd(raw: string, sourceIndex: number, character: string) {
  if (character === '\n' && raw[sourceIndex] === '\r' && raw[sourceIndex + 1] === '\n') {
    return sourceIndex + 2;
  }
  return raw[sourceIndex] === character ? sourceIndex + 1 : undefined;
}

function continuationContentStart(raw: string, sourceIndex: number) {
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
