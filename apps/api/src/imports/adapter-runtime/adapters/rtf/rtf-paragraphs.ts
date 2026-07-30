import { ScreenplayAdapterSourceError, type ScreenplayConversionWarning } from '@coda/contracts';
import {
  codePageForCharsetKeyword,
  decodeCodePageByte,
  decodeCodePageRun,
  decodeRtfUnicodeParameter,
  isExactlyDecodableCodePage,
  RTF_DEFAULT_CODE_PAGE,
} from './rtf-encoding';
import { isSkippedDestination, notableDestinationLabel } from './rtf-destinations';
import { RtfParagraphText, type RtfCharacterFormat } from './rtf-paragraph-text';
import { RtfTokenizer } from './rtf-tokenizer';

export type RtfAlignment = 'left' | 'center' | 'right' | 'justify';

/**
 * Hard ceiling on `{` nesting. RTF writers never approach this; the number exists
 * so a document built to exhaust a recursive parser's call stack — the exact
 * fixture that disqualified `rtf-parser` in #247 — is rejected as `invalid-source`
 * after a few hundred bytes, with the group stack bounded to a fixed size.
 */
export const RTF_MAX_GROUP_DEPTH = 256;

/** Tokens between cooperative cancellation checks. */
const CANCELLATION_INTERVAL = 4_096;

/** Tokens between macrotask yields, which is what lets the soft deadline's timer fire. */
const YIELD_INTERVAL = 262_144;

/** Break control words a `\uc` fallback run must never be allowed to swallow. */
const STRUCTURAL_WORDS: ReadonlySet<string> = new Set([
  'par',
  'pard',
  'sect',
  'sectd',
  'page',
  'line',
  'cell',
  'row',
  'nestcell',
  'nestrow',
]);

/** Control words that stand in for a literal character. */
const LITERAL_WORDS: ReadonlyMap<string, string> = new Map([
  ['tab', ' '],
  ['emdash', '—'],
  ['endash', '–'],
  ['emspace', ' '],
  ['enspace', ' '],
  ['qmspace', ' '],
  ['lquote', '‘'],
  ['rquote', '’'],
  ['ldblquote', '“'],
  ['rdblquote', '”'],
  ['bullet', '•'],
  ['zwnj', ''],
  ['zwj', ''],
  ['softline', ' '],
]);

/** Control symbols that stand in for a literal character. */
const LITERAL_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ['\\', '\\'],
  ['{', '{'],
  ['}', '}'],
  ['~', ' '],
  ['-', ''],
  ['_', '-'],
]);

const ALIGNMENTS: ReadonlyMap<string, RtfAlignment> = new Map([
  ['ql', 'left'],
  ['qc', 'center'],
  ['qr', 'right'],
  ['qj', 'justify'],
]);

/** Character formatting Fountain has no syntax for. The text survives; the styling does not. */
const UNREPRESENTABLE_WORDS: ReadonlySet<string> = new Set([
  'strike',
  'striked',
  'strikedl',
  'scaps',
  'sub',
  'super',
  'outl',
  'shad',
  'embo',
  'impr',
]);

/** One paragraph of readable text, with the formatting the screenplay heuristics use. */
export interface RtfParagraph {
  /** Whitespace-normalised plain text. Empty means the paragraph is a separator. */
  text: string;
  /** The same text with Fountain emphasis delimiters and escapes applied. */
  markup: string;
  alignment: RtfAlignment;
  leftIndentTwips: number;
  /** Whether an explicit page break preceded this paragraph. */
  pageBreakBefore: boolean;
  /** Whether formatting Fountain cannot express (strikethrough, sub/superscript) was dropped. */
  unrepresentableFormatting: boolean;
  /** Byte range of the paragraph in the original document. */
  sourceStart: number;
  sourceEnd: number;
}

export interface RtfParseLimits {
  /** Stop once this many paragraphs with readable text have been kept. */
  maxParagraphs: number;
  /** Stop once this many characters of readable text have been accumulated. */
  maxTextCharacters: number;
  /** Never report more document warnings than this. */
  maxWarnings: number;
}

export interface RtfParseOptions {
  limits: RtfParseLimits;
  throwIfCancelled: () => void;
}

export interface RtfParseResult {
  paragraphs: RtfParagraph[];
  warnings: ScreenplayConversionWarning[];
  /** Whether a limit stopped the walk early, so the output is deliberately over budget. */
  truncated: boolean;
}

interface RtfGroupState {
  skip: boolean;
  hidden: boolean;
  uc: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  caps: boolean;
  unrepresentable: boolean;
  alignment: RtfAlignment;
  leftIndentTwips: number;
}

function initialGroupState(): RtfGroupState {
  return {
    skip: false,
    hidden: false,
    uc: 1,
    bold: false,
    italic: false,
    underline: false,
    caps: false,
    unrepresentable: false,
    alignment: 'left',
    leftIndentTwips: 0,
  };
}

/** Returns to the macrotask queue so the runtime's soft-deadline timer can fire. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Rejects anything that is not an RTF document before a single token is read.
 *
 * Cheap, but it is the difference between an attributable "this is not RTF" and
 * a confusing "no readable text" after walking a megabyte of something else.
 */
export function assertRtfSignature(bytes: Uint8Array): void {
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  while (offset < bytes.length && bytes[offset]! <= 0x20) offset += 1;
  const header = decodeCodePageRun(bytes, offset, Math.min(offset + 5, bytes.length));
  if (header !== '{\\rtf') {
    throw new ScreenplayAdapterSourceError('Document does not begin with an RTF header');
  }
}

/**
 * Walks an RTF document into paragraphs.
 *
 * Nesting is an explicit array of group states with a hard depth cap, never the
 * call stack, and the walk is asynchronous solely so it can return to the event
 * loop periodically: the adapter runtime's soft deadline is a timer, and a purely
 * synchronous walk would be hard-terminated by the host instead of reporting an
 * attributable `timeout`.
 */
export async function parseRtfParagraphs(
  bytes: Uint8Array,
  options: RtfParseOptions,
): Promise<RtfParseResult> {
  assertRtfSignature(bytes);
  const walker = new RtfWalker(bytes, options);
  await walker.run();
  return walker.result();
}

class RtfWalker {
  private readonly tokenizer: RtfTokenizer;

  private readonly bytes: Uint8Array;

  private readonly options: RtfParseOptions;

  private readonly stack: RtfGroupState[] = [initialGroupState()];

  private readonly paragraphs: RtfParagraph[] = [];

  private readonly warnings = new Map<string, ScreenplayConversionWarning>();

  private readonly current = new RtfParagraphText();

  private pendingUnicodeSkip = 0;

  private atGroupStart = false;

  private awaitingDestinationName = false;

  private paragraphStart = 0;

  private pageBreakPending = false;

  private totalCharacters = 0;

  private keptParagraphs = 0;

  private binBytesSkipped = 0;

  private truncated = false;

  constructor(bytes: Uint8Array, options: RtfParseOptions) {
    this.bytes = bytes;
    this.options = options;
    this.tokenizer = new RtfTokenizer(bytes);
  }

  private get state(): RtfGroupState {
    return this.stack[this.stack.length - 1]!;
  }

  private get format(): RtfCharacterFormat {
    const state = this.state;
    return {
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
      unrepresentable: state.unrepresentable,
    };
  }

  async run(): Promise<void> {
    const tokenizer = this.tokenizer;
    let tokens = 0;
    while (!this.truncated && tokenizer.next()) {
      tokens += 1;
      if (tokens % CANCELLATION_INTERVAL === 0) this.options.throwIfCancelled();
      if (tokens % YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
        this.options.throwIfCancelled();
      }
      this.dispatch();
    }
    this.finishParagraph(tokenizer.offset);
    if (this.stack.length > 1) {
      this.warn('RTF_UNBALANCED_GROUPS', 'The document ended with unclosed groups.');
    }
    if (this.binBytesSkipped > 0) {
      this.warn(
        'RTF_BINARY_SKIPPED',
        `${this.binBytesSkipped} bytes of embedded binary data were skipped.`,
      );
    }
  }

  result(): RtfParseResult {
    return {
      paragraphs: this.paragraphs,
      warnings: [...this.warnings.values()],
      truncated: this.truncated,
    };
  }

  private dispatch(): void {
    const tokenizer = this.tokenizer;
    if (tokenizer.malformed) {
      this.warn('RTF_MALFORMED_CONTROL', 'Malformed RTF control sequences were recovered.');
    }
    this.binBytesSkipped += tokenizer.binBytesSkipped;
    switch (tokenizer.type) {
      case 'group-start':
        this.openGroup();
        return;
      case 'group-end':
        this.closeGroup();
        return;
      case 'control-word':
        this.handleControlWord();
        return;
      case 'control-symbol':
        this.handleControlSymbol();
        return;
      case 'text':
        this.handleText();
    }
  }

  private openGroup(): void {
    this.pendingUnicodeSkip = 0;
    if (this.stack.length >= RTF_MAX_GROUP_DEPTH) {
      throw new ScreenplayAdapterSourceError(
        `RTF group nesting exceeds the ${RTF_MAX_GROUP_DEPTH}-level limit`,
      );
    }
    this.stack.push({ ...this.state });
    this.atGroupStart = true;
    this.awaitingDestinationName = false;
  }

  private closeGroup(): void {
    this.pendingUnicodeSkip = 0;
    this.atGroupStart = false;
    this.awaitingDestinationName = false;
    if (this.stack.length <= 1) {
      this.warn('RTF_STRAY_GROUP_END', 'Unmatched closing braces were ignored.');
      return;
    }
    this.stack.pop();
  }

  private handleControlWord(): void {
    const { word, param, hasParam } = this.tokenizer;
    const atStart = this.atGroupStart;
    this.atGroupStart = false;
    if (this.awaitingDestinationName) {
      this.awaitingDestinationName = false;
      this.skipDestination(word);
      return;
    }
    if (atStart && isSkippedDestination(word)) {
      this.skipDestination(word);
      return;
    }
    if (this.consumeUnicodeSkip(word)) return;
    if (this.applyBreak(word)) return;
    if (this.applyEncoding(word, param, hasParam)) return;
    if (this.applyParagraphFormat(word, param, hasParam)) return;
    if (this.applyCharacterFormat(word, param, hasParam)) return;
    const literal = LITERAL_WORDS.get(word);
    if (literal !== undefined) this.appendText(literal);
  }

  private handleControlSymbol(): void {
    const { word } = this.tokenizer;
    this.atGroupStart = false;
    if (word === '*') {
      // `{\*\name ...}` marks a destination ignorable by construction, which is
      // how RTF stays forward compatible: a reader skips extensions it has never
      // heard of rather than emitting their internals as prose.
      this.state.skip = true;
      this.awaitingDestinationName = true;
      return;
    }
    if (word === '\n' || word === '\r') {
      this.finishParagraph(this.tokenizer.end);
      return;
    }
    if (this.pendingUnicodeSkip > 0) {
      this.pendingUnicodeSkip -= 1;
      return;
    }
    if (word === "'" && this.tokenizer.hasParam) {
      this.appendText(decodeCodePageByte(this.tokenizer.param));
      return;
    }
    const literal = LITERAL_SYMBOLS.get(word);
    if (literal !== undefined) this.appendText(literal);
  }

  private handleText(): void {
    this.atGroupStart = false;
    this.awaitingDestinationName = false;
    let start = this.tokenizer.start;
    const end = this.tokenizer.end;
    if (this.pendingUnicodeSkip > 0) {
      const skipped = Math.min(this.pendingUnicodeSkip, end - start);
      this.pendingUnicodeSkip -= skipped;
      start += skipped;
    }
    // Decoding is deferred until after the skip checks so text inside a skipped
    // destination — a font table, a `\pict` payload — is never materialised.
    if (start >= end || this.state.skip || this.state.hidden) return;
    this.appendText(decodeCodePageRun(this.bytes, start, end));
  }

  /**
   * Swallows the code-page approximation that follows `\uN`. Structural words are
   * exempt: a fallback run never contains `\par`, and letting one be eaten would
   * merge two paragraphs into one.
   */
  private consumeUnicodeSkip(word: string): boolean {
    if (this.pendingUnicodeSkip <= 0 || STRUCTURAL_WORDS.has(word)) return false;
    this.pendingUnicodeSkip -= 1;
    return true;
  }

  private applyBreak(word: string): boolean {
    switch (word) {
      case 'par':
      case 'sect':
      case 'row':
      case 'nestrow':
        this.finishParagraph(this.tokenizer.end);
        return true;
      case 'page':
        this.finishParagraph(this.tokenizer.end);
        this.pageBreakPending = true;
        return true;
      case 'cell':
      case 'nestcell':
        this.warn('RTF_TABLE_FLATTENED', 'Table cells were flattened into separate paragraphs.');
        this.finishParagraph(this.tokenizer.end);
        return true;
      case 'line':
        this.appendText(' ');
        return true;
      case 'pard':
        this.state.alignment = 'left';
        this.state.leftIndentTwips = 0;
        return true;
      default:
        return false;
    }
  }

  private applyEncoding(word: string, param: number, hasParam: boolean): boolean {
    if (word === 'u') {
      this.appendUnicode(param, hasParam);
      return true;
    }
    if (word === 'uc') {
      this.state.uc = hasParam ? Math.min(Math.max(param, 0), 255) : 1;
      return true;
    }
    if (word === 'ansicpg') {
      this.setCodePage(hasParam ? param : RTF_DEFAULT_CODE_PAGE);
      return true;
    }
    const keywordCodePage = codePageForCharsetKeyword(word);
    if (keywordCodePage === undefined) return false;
    this.setCodePage(keywordCodePage);
    return true;
  }

  private setCodePage(codePage: number): void {
    if (isExactlyDecodableCodePage(codePage)) return;
    this.warn(
      'RTF_UNSUPPORTED_CODE_PAGE',
      `Code page ${codePage} is not supported; text was decoded as Windows-1252, so ` +
        'non-ASCII characters may be wrong.',
    );
  }

  private appendUnicode(param: number, hasParam: boolean): void {
    if (!hasParam) return;
    const { text, outOfRange } = decodeRtfUnicodeParameter(param);
    if (outOfRange) {
      this.warn(
        'RTF_UNICODE_OUT_OF_RANGE',
        'Unicode escapes outside the valid range were replaced.',
      );
    }
    this.appendText(text);
    this.pendingUnicodeSkip = this.state.uc;
  }

  private applyParagraphFormat(word: string, param: number, hasParam: boolean): boolean {
    const alignment = ALIGNMENTS.get(word);
    if (alignment !== undefined) {
      this.state.alignment = alignment;
      return true;
    }
    if (word === 'li' || word === 'lin') {
      this.state.leftIndentTwips = hasParam ? Math.max(param, 0) : 0;
      return true;
    }
    return false;
  }

  private applyCharacterFormat(word: string, param: number, hasParam: boolean): boolean {
    const state = this.state;
    const on = !hasParam || param !== 0;
    switch (word) {
      case 'plain':
        state.bold = false;
        state.italic = false;
        state.underline = false;
        state.caps = false;
        state.unrepresentable = false;
        return true;
      case 'b':
        state.bold = on;
        return true;
      case 'i':
        state.italic = on;
        return true;
      case 'caps':
        state.caps = on;
        return true;
      case 'v':
        state.hidden = on;
        return true;
      default:
        return this.applyExtendedCharacterFormat(word, on);
    }
  }

  private applyExtendedCharacterFormat(word: string, on: boolean): boolean {
    const state = this.state;
    if (word === 'ulnone') {
      state.underline = false;
      return true;
    }
    if (word.startsWith('ul')) {
      state.underline = on;
      return true;
    }
    if (!UNREPRESENTABLE_WORDS.has(word)) return false;
    state.unrepresentable = on;
    if (on) {
      this.warn(
        'RTF_FORMATTING_DROPPED',
        'Strikethrough, small caps, subscript or superscript formatting was dropped.',
      );
    }
    return true;
  }

  private skipDestination(word: string): void {
    this.state.skip = true;
    const label = notableDestinationLabel(word);
    if (label !== undefined) {
      this.warn('RTF_DESTINATION_SKIPPED', `Content Fountain cannot carry was skipped: ${label}.`);
    }
  }

  private appendText(text: string): void {
    const state = this.state;
    if (state.skip || state.hidden || text === '') return;
    this.current.append(state.caps ? text.toUpperCase() : text, this.format);
    this.totalCharacters += text.length;
    if (this.totalCharacters > this.options.limits.maxTextCharacters) this.truncated = true;
  }

  /**
   * Closes the paragraph under construction. Runs of blank paragraphs collapse to
   * one: they are separators, and collapsing them is what makes a document built
   * from a few million bare `\par` tokens cost a constant number of records
   * instead of one per token.
   */
  private finishParagraph(endOffset: number): void {
    const text = this.current.toPlainText();
    const previous = this.paragraphs[this.paragraphs.length - 1];
    const collapsible = text === '' && (previous === undefined || previous.text === '');
    if (!collapsible) {
      this.paragraphs.push({
        text,
        markup: this.current.toMarkup(),
        alignment: this.state.alignment,
        leftIndentTwips: this.state.leftIndentTwips,
        pageBreakBefore: this.pageBreakPending,
        unrepresentableFormatting: this.current.unrepresentableFormatting,
        sourceStart: this.paragraphStart,
        sourceEnd: Math.max(endOffset, this.paragraphStart),
      });
      this.pageBreakPending = false;
      if (text !== '') this.keptParagraphs += 1;
    }
    if (this.keptParagraphs >= this.options.limits.maxParagraphs) this.truncated = true;
    this.current.reset();
    this.paragraphStart = endOffset;
  }

  private warn(code: string, message: string): void {
    if (this.warnings.has(code)) return;
    if (this.warnings.size >= this.options.limits.maxWarnings) return;
    this.warnings.set(code, { code, message });
  }
}
