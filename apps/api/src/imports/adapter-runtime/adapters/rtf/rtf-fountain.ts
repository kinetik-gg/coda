/**
 * Renders classified RTF blocks as canonical Fountain, with a per-block report.
 *
 * Two things make this more than string concatenation.
 *
 * First, Fountain is context-sensitive: an uppercase line becomes a character
 * cue whether or not that was intended, and a line beginning `INT.` becomes a
 * scene heading. So every block is checked against the syntax Fountain would
 * infer on its own, and forced with `!`, `.`, `@` or `>` whenever the inferred
 * reading would disagree with the classification. Round-tripping the emitted
 * text through `parseFountain` therefore reproduces the classification exactly,
 * which is the property the adapter's test asserts.
 *
 * Second, the output and element ceilings are enforced *while* emitting rather
 * than after. The runtime's V8 heap ceiling does not bound external memory
 * (#247 measured 1.1 GB of RSS growth against 3 MB of heap growth), so "build
 * everything, then check" is not a bound at all. Emission stops one block past
 * the ceiling, which leaves the returned payload just over budget — exactly
 * what the runtime needs to report an attributable `output-too-large` or
 * `element-limit` instead of silently truncating a screenplay.
 */
import type { ScreenplayConversionElement, ScreenplayConversionWarning } from '@coda/contracts';
import {
  readsAsCharacterCue,
  readsAsSceneHeading,
  readsAsTransition,
  type RtfBlock,
  type RtfBlockKind,
} from './rtf-classification';

/** Fountain's own page-break marker. */
const PAGE_BREAK = '===';

/** Characters that make Fountain read a line as something other than plain action. */
const ACTION_SIGILS = ['.', '>', '@', '~', '#', '=', '!', '*', '_', '(', '['];

export interface RtfEmitLimits {
  maxOutputCharacters: number;
  maxElements: number;
}

export interface RtfEmitOptions {
  limits: RtfEmitLimits;
  throwIfCancelled: () => void;
}

export interface RtfEmitResult {
  convertedFountain: string;
  elements: ScreenplayConversionElement[];
  warnings: ScreenplayConversionWarning[];
}

interface RenderedBlock {
  text: string;
  /** Whether emission had to change the text to preserve the classification. */
  transformed: boolean;
}

function forcedIfNeeded(text: string, alreadyReads: boolean, sigil: string): RenderedBlock {
  return alreadyReads
    ? { text, transformed: false }
    : { text: `${sigil}${text}`, transformed: true };
}

/** Whether Fountain would misread a plain action line, and so it must be forced with `!`. */
function actionNeedsForcing(text: string): boolean {
  if (readsAsSceneHeading(text) || readsAsTransition(text) || readsAsCharacterCue(text))
    return true;
  return ACTION_SIGILS.some((sigil) => text.startsWith(sigil));
}

function renderBlock(block: RtfBlock): RenderedBlock {
  const { text, markup } = block.paragraph;
  switch (block.kind) {
    case 'scene_heading':
      return forcedIfNeeded(text, readsAsSceneHeading(text), '.');
    case 'transition':
      return forcedIfNeeded(text, readsAsTransition(text), '> ');
    case 'character':
      return forcedIfNeeded(text, readsAsCharacterCue(text) && !readsAsSceneHeading(text), '@');
    case 'centered':
      return { text: `> ${text} <`, transformed: true };
    case 'parenthetical':
      return { text, transformed: false };
    case 'action':
      return actionNeedsForcing(markup)
        ? { text: `!${markup}`, transformed: true }
        : { text: markup, transformed: markup !== text };
    case 'dialogue':
      return { text: markup, transformed: markup !== text };
  }
}

/**
 * Whether a block continues the previous one inside a single dialogue unit, in
 * which case Fountain requires a single newline rather than a blank line.
 */
function isDialogueContinuation(kind: RtfBlockKind, previous: RtfBlockKind | undefined): boolean {
  if (kind !== 'dialogue' && kind !== 'parenthetical') return false;
  return previous === 'character' || previous === 'parenthetical' || previous === 'dialogue';
}

function statusFor(
  block: RtfBlock,
  rendered: RenderedBlock,
): ScreenplayConversionElement['status'] {
  if (block.paragraph.unrepresentableFormatting) return 'unsupported';
  if (block.inferred) return 'uncertain';
  return rendered.transformed ? 'converted' : 'preserved';
}

function summaryFor(block: RtfBlock, status: ScreenplayConversionElement['status']): string {
  const kind = block.kind.replace('_', ' ');
  switch (status) {
    case 'unsupported':
      return `Converted an RTF paragraph to Fountain ${kind}; character formatting Fountain cannot express was dropped.`;
    case 'uncertain':
      return `Inferred Fountain ${kind} from the RTF paragraph's text and formatting.`;
    case 'converted':
      return `Converted an RTF paragraph to Fountain ${kind}.`;
    case 'preserved':
      return `Preserved an RTF paragraph verbatim as Fountain ${kind}.`;
  }
}

function elementWarnings(block: RtfBlock): ScreenplayConversionWarning[] {
  if (!block.paragraph.unrepresentableFormatting) return [];
  return [
    {
      code: 'RTF_FORMATTING_DROPPED',
      message: 'Strikethrough, small caps, subscript or superscript formatting was dropped.',
    },
  ];
}

/** Accumulates Fountain text and its report, stopping one block past any ceiling. */
class FountainEmitter {
  private readonly parts: string[] = [];

  readonly elements: ScreenplayConversionElement[] = [];

  private cursor = 0;

  private previousKind: RtfBlockKind | undefined;

  private counter = 0;

  constructor(private readonly limits: RtfEmitLimits) {}

  /** Whether a ceiling has been crossed, so the caller must stop immediately. */
  get overBudget(): boolean {
    return (
      this.cursor > this.limits.maxOutputCharacters ||
      this.elements.length > this.limits.maxElements
    );
  }

  toString(): string {
    return this.parts.join('');
  }

  /** Writes a page break, which has no source paragraph of its own. */
  writePageBreak(): void {
    this.write(PAGE_BREAK, false);
    this.previousKind = undefined;
  }

  writeBlock(block: RtfBlock): void {
    const rendered = renderBlock(block);
    if (rendered.text === '') return;
    const continuation = isDialogueContinuation(block.kind, this.previousKind);
    const start = this.write(rendered.text, continuation);
    this.previousKind = block.kind;
    this.counter += 1;
    const status = statusFor(block, rendered);
    this.elements.push({
      id: `paragraph-${this.counter}`,
      status,
      source: {
        kind: 'rtf-paragraph',
        location: {
          unit: 'byte',
          start: block.paragraph.sourceStart,
          end: block.paragraph.sourceEnd,
        },
      },
      target: {
        kind: block.kind,
        location: { unit: 'character', start, end: start + rendered.text.length },
      },
      summary: summaryFor(block, status),
      warnings: elementWarnings(block),
    });
  }

  /** Appends a block with its separator and returns the offset its text starts at. */
  private write(text: string, continuation: boolean): number {
    if (this.parts.length > 0) {
      const separator = continuation ? '\n' : '\n\n';
      this.parts.push(separator);
      this.cursor += separator.length;
    }
    const start = this.cursor;
    this.parts.push(text);
    this.cursor += text.length;
    return start;
  }
}

/** Renders classified blocks to Fountain, stopping as soon as a ceiling is crossed. */
export function emitRtfFountain(
  blocks: readonly RtfBlock[],
  options: RtfEmitOptions,
): RtfEmitResult {
  const emitter = new FountainEmitter(options.limits);
  for (let index = 0; index < blocks.length; index += 1) {
    if (index % 512 === 0) options.throwIfCancelled();
    const block = blocks[index]!;
    if (block.paragraph.pageBreakBefore) emitter.writePageBreak();
    emitter.writeBlock(block);
    if (emitter.overBudget) break;
  }
  return {
    convertedFountain: emitter.toString(),
    elements: emitter.elements,
    warnings: [],
  };
}
