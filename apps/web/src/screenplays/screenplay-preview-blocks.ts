import type { FountainAnnotation, FountainDocument, FountainElement } from '@coda/fountain';
import type {
  LayoutToken,
  ScreenplayLayoutBlankLine,
  ScreenplayPreviewBlock,
  ScreenplayPreviewInlineStyle,
  ScreenplaySemanticTokens,
} from './screenplay-preview-types';

type RawLayoutToken = LayoutToken | { kind: 'dual-dialogue-barrier' };
type BlockBlankLines = Readonly<{
  before?: readonly ScreenplayLayoutBlankLine[];
  after?: readonly ScreenplayLayoutBlankLine[];
}>;

export function semanticTokens(document: FountainDocument): ScreenplaySemanticTokens {
  const blankLines = preservedBlankLines(document.elements);
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
      titleBlock = previewBlock(
        element,
        sceneSequence,
        document.annotations,
        blankLines.get(element),
      );
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
    const consumed = consumePrintableElement(document, index, sceneSequence, blankLines);
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

function preservedBlankLines(
  elements: readonly FountainElement[],
): ReadonlyMap<FountainElement, BlockBlankLines> {
  const result = new Map<FountainElement, BlockBlankLines>();
  let index = 0;
  while (index < elements.length) {
    if (elements[index]?.kind !== 'separator') {
      index += 1;
      continue;
    }
    const runStart = index;
    while (elements[index]?.kind === 'separator') index += 1;
    const separators = elements
      .slice(runStart, index)
      .map((element) => ({ sourceStart: element.start, sourceEnd: element.end }));
    const previous = elements[runStart - 1];
    const next = elements[index];
    if (!previous && next && isBodyPrintable(next)) {
      appendBlankLines(result, next, 'before', separators);
    } else if (!next && previous && isBodyPrintable(previous)) {
      appendBlankLines(result, previous, 'after', separators);
    } else if (previous && next && isBodyPrintable(previous) && isBodyPrintable(next)) {
      appendBlankLines(result, next, 'before', separators.slice(minimumSpacingBefore(next)));
    }
  }
  return result;
}

function appendBlankLines(
  result: Map<FountainElement, BlockBlankLines>,
  element: FountainElement,
  position: 'before' | 'after',
  lines: readonly ScreenplayLayoutBlankLine[],
): void {
  if (!lines.length) return;
  const current = result.get(element);
  result.set(element, {
    ...current,
    [position]: Object.freeze([...(current?.[position] ?? []), ...lines]),
  });
}

function isBodyPrintable(element: FountainElement): boolean {
  return (
    element.kind === 'action' ||
    element.kind === 'centered' ||
    element.kind === 'character' ||
    element.kind === 'dialogue' ||
    element.kind === 'lyric' ||
    element.kind === 'parenthetical' ||
    element.kind === 'scene_heading' ||
    element.kind === 'transition'
  );
}

function minimumSpacingBefore(element: FountainElement): number {
  if (element.kind === 'scene_heading') return 2;
  if (
    element.kind === 'action' ||
    element.kind === 'centered' ||
    element.kind === 'character' ||
    element.kind === 'lyric' ||
    element.kind === 'transition'
  ) {
    return 1;
  }
  return 0;
}

function consumePrintableElement(
  document: FountainDocument,
  index: number,
  sceneSequence: number,
  blankLines: ReadonlyMap<FountainElement, BlockBlankLines>,
): {
  nextIndex: number;
  sceneSequence: number;
  blocks: ScreenplayPreviewBlock[];
  token?: LayoutToken;
} {
  const element = document.elements[index];
  if (!element) return { nextIndex: index + 1, sceneSequence, blocks: [] };
  const block = previewBlock(element, sceneSequence, document.annotations, blankLines.get(element));
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
    blankLines,
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
  blankLines: ReadonlyMap<FountainElement, BlockBlankLines>,
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
      blankLines.get(element),
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
      previous?.kind === 'dialogue'
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
  blankLines?: BlockBlankLines,
): ScreenplayPreviewBlock | undefined {
  const common = {
    id: `preview-block-${element.lineStart + 1}-${element.start}`,
    sourceStart: element.start,
    sourceEnd: element.end,
    lineStart: element.lineStart,
    lineEnd: element.lineEnd,
    ...(blankLines?.before?.length
      ? { layoutBlankLinesBefore: Object.freeze([...blankLines.before]) }
      : {}),
    ...(blankLines?.after?.length
      ? { layoutBlankLinesAfter: Object.freeze([...blankLines.after]) }
      : {}),
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
