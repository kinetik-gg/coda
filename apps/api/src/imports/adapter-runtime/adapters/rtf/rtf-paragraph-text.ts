/**
 * Accumulates one RTF paragraph's text as formatted runs, and renders those runs
 * twice: once as plain text for classification, once as Fountain markup.
 *
 * Runs rather than a streaming string because Fountain's emphasis delimiters are
 * whitespace-sensitive — `* text *` is literal, `*text*` is italic — so the
 * markers have to be placed after a run's extent is known, not while bytes are
 * still arriving. Buffering runs also makes the common no-op case free: RTF
 * toggles character formatting constantly with no intervening text, and merging
 * adjacent equal-format runs means a document that writes `\b0` two million
 * times allocates nothing at all.
 */

/** Character formatting that survives into Fountain, or is reported as lost. */
export interface RtfCharacterFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** `\strike`/`\striked`, `\sub`, `\super`, `\scaps`: kept as text, formatting dropped. */
  unrepresentable: boolean;
}

interface RtfTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** Backslash-escapes the delimiters Fountain would otherwise read as emphasis. */
function escapeFountainInline(text: string): string {
  return text.replace(/[\\*_]/gu, (match) => `\\${match}`);
}

/** Splits a run into leading whitespace, core, and trailing whitespace. */
function splitSurroundingSpace(text: string): [string, string, string] {
  const leadMatch = /^\s*/u.exec(text)!;
  const lead = leadMatch[0];
  if (lead.length === text.length) return [lead, '', ''];
  const trailMatch = /\s*$/u.exec(text)!;
  const trail = trailMatch[0];
  return [lead, text.slice(lead.length, text.length - trail.length), trail];
}

/**
 * Renders one run with its emphasis delimiters. Whitespace is pushed outside the
 * delimiters so `**bold** ` parses as emphasis rather than as three literal
 * asterisks, and a run that is nothing but whitespace never grows markers at all.
 */
function renderRun(run: RtfTextRun): string {
  const [lead, core, trail] = splitSurroundingSpace(run.text);
  if (core === '') return lead + trail;
  const escaped = escapeFountainInline(core);
  if (!run.bold && !run.italic && !run.underline) return lead + escaped + trail;
  const open = `${run.underline ? '_' : ''}${run.bold ? '**' : ''}${run.italic ? '*' : ''}`;
  const close = `${run.italic ? '*' : ''}${run.bold ? '**' : ''}${run.underline ? '_' : ''}`;
  return `${lead}${open}${escaped}${close}${trail}`;
}

/** Collapses RTF's incidental whitespace — tabs, runs of spaces — to single spaces. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** One paragraph under construction. Reset and reused across a document. */
export class RtfParagraphText {
  private runs: RtfTextRun[] = [];

  private characters = 0;

  /** Whether any run in this paragraph carried formatting Fountain cannot express. */
  unrepresentableFormatting = false;

  /** Characters of literal text appended so far, before normalisation. */
  get length(): number {
    return this.characters;
  }

  /** Whether nothing but whitespace has been appended. */
  get isBlank(): boolean {
    return this.characters === 0 || this.runs.every((run) => run.text.trim() === '');
  }

  /**
   * Appends literal text under `format`. Adjacent runs with identical emphasis
   * are merged so the rendered markup never contains an empty `****` pair.
   */
  append(text: string, format: RtfCharacterFormat): void {
    if (text === '') return;
    this.characters += text.length;
    if (format.unrepresentable) this.unrepresentableFormatting = true;
    const last = this.runs[this.runs.length - 1];
    if (
      last &&
      last.bold === format.bold &&
      last.italic === format.italic &&
      last.underline === format.underline
    ) {
      last.text += text;
      return;
    }
    this.runs.push({
      text,
      bold: format.bold,
      italic: format.italic,
      underline: format.underline,
    });
  }

  /** Plain text with whitespace normalised. This is what classification reads. */
  toPlainText(): string {
    let text = '';
    for (const run of this.runs) text += run.text;
    return normalizeWhitespace(text);
  }

  /** Fountain markup with whitespace normalised. This is what is emitted. */
  toMarkup(): string {
    let text = '';
    for (const run of this.runs) text += renderRun(run);
    return normalizeWhitespace(text);
  }

  /** Discards everything, ready for the next paragraph. */
  reset(): void {
    this.runs = [];
    this.characters = 0;
    this.unrepresentableFormatting = false;
  }
}
