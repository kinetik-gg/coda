/**
 * Deterministic screenplay heuristics over RTF paragraphs.
 *
 * RTF carries no screenplay semantics: a scene heading and a line of action are
 * both just paragraphs, distinguished in the original only by typography a word
 * processor applied. Classification therefore has to be inferred, and the one
 * property that matters more than accuracy is that it is *deterministic and
 * explainable* — the conversion report tells a reader which blocks were inferred
 * confidently and which were a guess, so a wrong guess is visible rather than
 * silently baked into the imported screenplay.
 *
 * The rules use only the text and the paragraph's own alignment/indent, never a
 * whole-document statistical model, so re-importing the same file always yields
 * the same classification.
 */
import type { RtfParagraph } from './rtf-paragraphs';

/** The Fountain construct a source paragraph became. */
export type RtfBlockKind =
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'centered';

export interface RtfBlock {
  kind: RtfBlockKind;
  paragraph: RtfParagraph;
  /** Whether the rule that produced {@link kind} was a heuristic guess rather than explicit syntax. */
  inferred: boolean;
}

const SCENE_HEADING = /^(?:INT\.\/EXT|INT\/EXT|I\/E|INT|EXT|EST)(?:\.|\s)/iu;
const PARENTHETICAL = /^\([^()]*\)$/u;

/** Longest paragraph still plausible as a character cue. */
const MAX_CUE_LENGTH = 60;

/** Whether Fountain's own parser would read `text` as a scene heading unaided. */
export function readsAsSceneHeading(text: string): boolean {
  return SCENE_HEADING.test(text);
}

/** Whether Fountain's own parser would read `text` as an automatic transition. */
export function readsAsTransition(text: string): boolean {
  return /\p{L}/u.test(text) && text === text.toUpperCase() && text.endsWith('TO:');
}

/** Whether Fountain's own parser would read `text` as a character cue unaided. */
export function readsAsCharacterCue(text: string): boolean {
  const withoutExtension = text.replace(/\s+\([^\n]*\)$/u, '');
  return /\p{L}/u.test(withoutExtension) && withoutExtension === withoutExtension.toUpperCase();
}

function isParenthetical(text: string): boolean {
  return PARENTHETICAL.test(text);
}

/** A right-aligned uppercase paragraph is how word processors set a transition. */
function isTransitionCandidate(paragraph: RtfParagraph): boolean {
  if (readsAsTransition(paragraph.text)) return true;
  return paragraph.alignment === 'right' && readsAsCharacterCue(paragraph.text);
}

/**
 * Whether the paragraph looks like a character cue introducing speech.
 *
 * The lookahead carries the weight. A cue is only a cue if something speaks
 * after it, so an uppercase line followed by a blank, by a scene heading, or by
 * a transition is a shouted line of action or a title — not a speaker. Without
 * this, a centred uppercase title becomes a character and everything after it is
 * swallowed as that character's dialogue.
 */
function isCueCandidate(paragraph: RtfParagraph, next: RtfParagraph | undefined): boolean {
  if (next === undefined || next.text === '') return false;
  if (readsAsSceneHeading(next.text) || isTransitionCandidate(next)) return false;
  if (paragraph.text.length > MAX_CUE_LENGTH) return false;
  if (readsAsSceneHeading(paragraph.text) || readsAsTransition(paragraph.text)) return false;
  return readsAsCharacterCue(paragraph.text);
}

interface DialogueRun {
  active: boolean;
  /** Indent of the cue that opened the run, used to spot the next cue at the same indent. */
  cueIndentTwips: number;
}

/**
 * Classifies a paragraph while a dialogue run is open. Dialogue continues until a
 * blank paragraph, a scene heading, a transition, or another cue set at exactly
 * the indent the run's own cue used — which is how a document that separates
 * speeches by indentation rather than by blank lines still splits correctly,
 * without misreading a shouted line of dialogue as a new speaker.
 */
function classifyInsideDialogue(
  paragraph: RtfParagraph,
  next: RtfParagraph | undefined,
  run: DialogueRun,
): RtfBlock {
  if (isParenthetical(paragraph.text)) {
    return { kind: 'parenthetical', paragraph, inferred: false };
  }
  if (
    paragraph.leftIndentTwips === run.cueIndentTwips &&
    isCueCandidate(paragraph, next) &&
    !isParenthetical(paragraph.text)
  ) {
    return { kind: 'character', paragraph, inferred: true };
  }
  return { kind: 'dialogue', paragraph, inferred: false };
}

/** Classifies a paragraph with no dialogue run open. */
function classifyAtTopLevel(paragraph: RtfParagraph, next: RtfParagraph | undefined): RtfBlock {
  if (isCueCandidate(paragraph, next)) {
    return { kind: 'character', paragraph, inferred: true };
  }
  if (paragraph.alignment === 'center') {
    return { kind: 'centered', paragraph, inferred: true };
  }
  return { kind: 'action', paragraph, inferred: false };
}

/**
 * Scene headings and transitions are checked before anything else, including
 * before an open dialogue run: they are unambiguous structural markers, and a
 * dialogue run that swallowed one would absorb the whole rest of the scene.
 */
function classifyParagraph(
  paragraph: RtfParagraph,
  next: RtfParagraph | undefined,
  run: DialogueRun,
): RtfBlock {
  if (readsAsSceneHeading(paragraph.text)) {
    return { kind: 'scene_heading', paragraph, inferred: false };
  }
  if (isTransitionCandidate(paragraph)) {
    return { kind: 'transition', paragraph, inferred: !readsAsTransition(paragraph.text) };
  }
  return run.active
    ? classifyInsideDialogue(paragraph, next, run)
    : classifyAtTopLevel(paragraph, next);
}

/**
 * Turns paragraphs into classified blocks. Blank paragraphs are dropped — they
 * are separators, and their only job is to close an open dialogue run — so the
 * result contains exactly one block per source paragraph that carried text.
 */
export function classifyRtfParagraphs(paragraphs: readonly RtfParagraph[]): RtfBlock[] {
  const blocks: RtfBlock[] = [];
  const run: DialogueRun = { active: false, cueIndentTwips: 0 };
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    const next = paragraphs[index + 1];
    if (paragraph.text === '') {
      run.active = false;
      continue;
    }
    const block = classifyParagraph(paragraph, next, run);
    if (block.kind === 'character') {
      run.active = true;
      run.cueIndentTwips = paragraph.leftIndentTwips;
    } else if (block.kind !== 'dialogue' && block.kind !== 'parenthetical') {
      run.active = false;
    }
    blocks.push(block);
  }
  return blocks;
}
