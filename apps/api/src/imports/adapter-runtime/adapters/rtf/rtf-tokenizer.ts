/**
 * A bounded, allocation-light RTF token scanner.
 *
 * This exists because #247 (`docs/adr-rtf-docx-parser-qualification.md`)
 * qualified every published RTF library and recommended adopting none of them.
 * The decisive finding was `rtf-parser` crashing with an uncaught
 * `RangeError: Maximum call stack size exceeded` on a 200,000-level nested-group
 * fixture: its group walker recurses, so nesting depth is bounded only by the
 * V8 call stack. Inside the adapter runtime that is an unattributable worker
 * crash rather than a clean `invalid-source` rejection.
 *
 * Two design rules follow, and both are load-bearing:
 *
 * 1. **No recursion anywhere in this file.** `{` and `}` are ordinary tokens;
 *    depth is a counter owned by the caller (`rtf-paragraphs.ts`), which caps it
 *    explicitly. The scanner itself is a flat loop over a `Uint8Array`.
 * 2. **No per-token allocation on the hot path.** The scanner is a pull cursor
 *    that overwrites its own public fields, so a control-word flood costs one
 *    short string per token rather than a token object plus a range object. Text
 *    is reported as a byte range into the caller's buffer and only decoded when
 *    the caller actually keeps it, so text inside a skipped destination
 *    (`{\*\...}`, `\pict`, `\fonttbl`) is never materialised at all.
 *
 * The scanner is deliberately tolerant: RTF written by real word processors is
 * frequently slightly malformed, so a broken construct sets {@link
 * RtfTokenizer.malformed} and recovery continues. Only the caller decides that
 * enough is wrong to reject the document.
 */

/** What {@link RtfTokenizer.type} holds after a successful {@link RtfTokenizer.next}. */
export type RtfTokenType = 'group-start' | 'group-end' | 'control-word' | 'control-symbol' | 'text';

/**
 * Longest control word the RTF specification allows (32 letters). Longer runs are
 * consumed and flagged rather than rejected, but they are capped so a flood of
 * letters cannot build an unbounded string.
 */
export const RTF_MAX_CONTROL_WORD_LENGTH = 32;

/** Hard ceiling on letters consumed for one control word before the rest is discarded. */
const CONTROL_WORD_SCAN_LIMIT = 255;

/** Most digits a numeric parameter may contribute before the value is clamped. */
const PARAMETER_DIGIT_LIMIT = 10;

/**
 * Clamp for a numeric parameter. RTF parameters are specified as signed 16-bit
 * values but real documents exceed that, and a hostile document can write
 * arbitrarily many digits; clamping keeps every downstream consumer working with
 * a safe integer without needing its own overflow check.
 */
export const RTF_MAX_PARAMETER = 2_147_483_647;

const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const APOSTROPHE = 0x27;
const HYPHEN = 0x2d;
const SPACE = 0x20;
const CR = 0x0d;
const LF = 0x0a;
const NUL = 0x00;

function isLetter(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function hexValue(byte: number): number {
  if (isDigit(byte)) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return -1;
}

/** ASCII-only decode of a control word. Control words are letters by definition. */
function asciiWord(bytes: Uint8Array, start: number, end: number): string {
  let word = '';
  for (let index = start; index < end; index += 1) word += String.fromCharCode(bytes[index]!);
  return word;
}

/**
 * A pull cursor over RTF bytes. Call {@link next} until it returns `false`; the
 * public fields describe the token that was just read and are only valid until
 * the following call.
 */
export class RtfTokenizer {
  /** Token category. Meaningless before the first successful {@link next}. */
  type: RtfTokenType = 'text';

  /**
   * For `control-word`, the lower-case-as-written control word without its
   * leading backslash. For `control-symbol`, the single symbol character (`'`
   * for a `\'hh` hex escape). Empty for every other token type.
   */
  word = '';

  /** Numeric parameter, clamped to +/- {@link RTF_MAX_PARAMETER}. `0` when absent. */
  param = 0;

  /** Whether a numeric parameter was actually present, which `\u0` needs to know. */
  hasParam = false;

  /** Byte offset of the token's first byte in the source buffer. */
  start = 0;

  /** Byte offset one past the token's last byte, including any `\bin` payload. */
  end = 0;

  /** Bytes of a `\bin` payload this token consumed. Always `0` for other tokens. */
  binBytesSkipped = 0;

  /**
   * Set when the token was recovered from a malformed construct: an
   * over-long control word, an over-long or truncated numeric parameter, a
   * `\'` escape without two hex digits, a `\bin` run claiming more bytes than
   * remain, or a trailing backslash at end of input.
   */
  malformed = false;

  private readonly bytes: Uint8Array;

  private position = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Byte offset the next {@link next} will read from. */
  get offset(): number {
    return this.position;
  }

  /**
   * Reads the next token, returning `false` at end of input. Carriage returns,
   * line feeds and NUL bytes between tokens are RTF whitespace and are skipped
   * here so no consumer has to.
   */
  next(): boolean {
    this.word = '';
    this.param = 0;
    this.hasParam = false;
    this.binBytesSkipped = 0;
    this.malformed = false;
    const { bytes } = this;
    const length = bytes.length;
    let position = this.position;
    while (position < length) {
      const byte = bytes[position]!;
      if (byte !== CR && byte !== LF && byte !== NUL) break;
      position += 1;
    }
    if (position >= length) {
      this.position = position;
      this.start = position;
      this.end = position;
      return false;
    }
    this.start = position;
    const byte = bytes[position]!;
    if (byte === OPEN_BRACE || byte === CLOSE_BRACE) {
      this.position = position + 1;
      this.end = this.position;
      this.type = byte === OPEN_BRACE ? 'group-start' : 'group-end';
      return true;
    }
    if (byte === BACKSLASH) {
      this.position = position + 1;
      return this.readControl();
    }
    this.position = position;
    return this.readText();
  }

  /**
   * Coalesces a run of literal bytes. The run is reported as a range rather than
   * a string: text inside a destination the caller skips is then never decoded,
   * which is what keeps a `\pict` payload or a font table from costing anything.
   */
  private readText(): boolean {
    const { bytes } = this;
    const length = bytes.length;
    let position = this.position;
    while (position < length) {
      const byte = bytes[position]!;
      if (
        byte === BACKSLASH ||
        byte === OPEN_BRACE ||
        byte === CLOSE_BRACE ||
        byte === CR ||
        byte === LF ||
        byte === NUL
      ) {
        break;
      }
      position += 1;
    }
    this.position = position;
    this.end = position;
    this.type = 'text';
    return true;
  }

  /** Dispatches whatever followed a backslash. `this.position` is already past it. */
  private readControl(): boolean {
    const { bytes } = this;
    if (this.position >= bytes.length) {
      this.type = 'control-symbol';
      this.malformed = true;
      this.end = this.position;
      return true;
    }
    const byte = bytes[this.position]!;
    if (isLetter(byte)) return this.readControlWord();
    if (byte === APOSTROPHE) return this.readHexEscape();
    this.word = String.fromCharCode(byte);
    this.position += 1;
    this.end = this.position;
    this.type = 'control-symbol';
    return true;
  }

  /** `\word`, optional signed parameter, optional single delimiting space. */
  private readControlWord(): boolean {
    const { bytes } = this;
    const length = bytes.length;
    const wordStart = this.position;
    let position = wordStart;
    while (position < length && position - wordStart < CONTROL_WORD_SCAN_LIMIT) {
      if (!isLetter(bytes[position]!)) break;
      position += 1;
    }
    // A run longer than the scan limit is not a control word any real writer
    // emits; consume the rest so the scanner cannot stall, and flag it.
    while (position < length && isLetter(bytes[position]!)) {
      position += 1;
      this.malformed = true;
    }
    const keptEnd = Math.min(wordStart + RTF_MAX_CONTROL_WORD_LENGTH, position);
    if (position - wordStart > RTF_MAX_CONTROL_WORD_LENGTH) this.malformed = true;
    this.word = asciiWord(bytes, wordStart, keptEnd);
    this.position = position;
    this.readParameter();
    if (this.position < length && bytes[this.position] === SPACE) this.position += 1;
    if (this.word === 'bin') this.skipBinaryPayload();
    this.end = this.position;
    this.type = 'control-word';
    return true;
  }

  /** Reads `-?[0-9]+` into {@link param}, clamped so no consumer sees an unsafe integer. */
  private readParameter(): void {
    const { bytes } = this;
    const length = bytes.length;
    let position = this.position;
    const negative = position < length && bytes[position] === HYPHEN;
    if (negative) position += 1;
    if (position >= length || !isDigit(bytes[position]!)) {
      // A lone `-` is not a parameter. Leave it for the next token to read as
      // text so no byte is silently dropped.
      if (negative) this.malformed = true;
      return;
    }
    let value = 0;
    let digits = 0;
    while (position < length && isDigit(bytes[position]!)) {
      if (digits < PARAMETER_DIGIT_LIMIT) value = value * 10 + (bytes[position]! - 0x30);
      digits += 1;
      position += 1;
    }
    if (digits > PARAMETER_DIGIT_LIMIT || value > RTF_MAX_PARAMETER) {
      value = RTF_MAX_PARAMETER;
      this.malformed = true;
    }
    this.position = position;
    this.hasParam = true;
    this.param = negative ? -value : value;
  }

  /**
   * `\binN` is followed by exactly N raw bytes that are not RTF at all. Skipping
   * them here — clamped to what actually remains — is what stops an embedded
   * object from being re-scanned as if it were markup, which is where a naive
   * tokenizer manufactures millions of bogus tokens from binary noise.
   */
  private skipBinaryPayload(): void {
    const remaining = this.bytes.length - this.position;
    if (!this.hasParam || this.param <= 0) return;
    const requested = this.param;
    const skipped = Math.min(requested, remaining);
    if (requested > remaining) this.malformed = true;
    this.position += skipped;
    this.binBytesSkipped = skipped;
  }

  /** `\'hh` — one raw byte in the current code page, reported as `param`. */
  private readHexEscape(): boolean {
    const { bytes } = this;
    this.word = "'";
    this.type = 'control-symbol';
    this.position += 1;
    const high = this.position < bytes.length ? hexValue(bytes[this.position]!) : -1;
    const low = this.position + 1 < bytes.length ? hexValue(bytes[this.position + 1]!) : -1;
    if (high < 0 || low < 0) {
      this.malformed = true;
      this.end = this.position;
      return true;
    }
    this.position += 2;
    this.hasParam = true;
    this.param = high * 16 + low;
    this.end = this.position;
    return true;
  }
}
