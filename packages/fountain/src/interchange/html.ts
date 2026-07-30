/**
 * HTML -> Fountain import.
 *
 * There is no DOM here, on purpose. `@xmldom/xmldom` (already a dependency,
 * used by the FDX importer) only parses well-formed XML; real, hostile, or
 * merely careless HTML is neither well-formed nor governed by a DTD, so
 * handing it to an XML parser would reject the majority of legitimate
 * uploads while providing no real safety benefit over a purpose-built scan.
 * Instead this module tokenizes the raw source directly: it tracks open
 * elements on a small stack, ignores `<script>`/`<style>`/other
 * non-content subtrees without ever evaluating them, decodes a fixed table of
 * entities, and emits Fountain text - it never constructs a DOM and never
 * calls anything resembling `innerHTML`.
 *
 * Classification of a text block (scene heading / character cue / dialogue /
 * transition / action) reuses the exact heuristics `@coda/fountain`'s own
 * parser already applies to plain Fountain lines
 * (`matchSceneHeading`/`matchCharacter`/`isTransitionCandidate`), so an HTML
 * upload is read the same way hand-authored Fountain would be. Everything
 * that does not resolve to one of those constructs becomes forced action
 * (`!text`), the same fallback the plain-text importer already uses - this is
 * deliberate: it guarantees uploaded text can never be reinterpreted as
 * unintended Fountain control syntax just because it happened to start with
 * a character like `@` or `.`.
 */
import { isTransitionCandidate, matchCharacter, matchSceneHeading } from '../classification';
import { assertHtmlPreflight, HtmlPreflightError } from './html-preflight';
import { requireNonEmptySource, type ScreenplayInput } from './input';
import { ScreenplayInterchangeError, type ScreenplayImportResult } from './types';

export const MAX_HTML_BYTES = 5_000_000;
export const MAX_HTML_ELEMENT_DEPTH = 128;
export const MAX_HTML_ELEMENT_COUNT = 50_000;
export const MAX_HTML_ATTRIBUTES_PER_ELEMENT = 200;
const HTML_PREFLIGHT_LIMITS = {
  maxElementDepth: MAX_HTML_ELEMENT_DEPTH,
  maxElementCount: MAX_HTML_ELEMENT_COUNT,
  maxAttributesPerElement: MAX_HTML_ATTRIBUTES_PER_ELEMENT,
};

/** Longest single decoded text block this importer will carry into one Fountain construct. */
const MAX_BLOCK_TEXT_LENGTH = 20_000;

/** A block-level tag both flushes the pending inline buffer and is itself content-bearing. */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Void elements never close and never carry children. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Content is skipped entirely and never tokenized as markup: `<script>` and
 * `<style>` are active/presentational content the issue calls out by name;
 * `<textarea>`/`<title>` are the other HTML5 raw-text elements.
 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Subtrees ignored for content purposes but still tokenized as markup (they
 * can contain arbitrary nesting, unlike raw-text elements): non-rendered
 * document metadata, embedded foreign content, and interactive form
 * controls, none of which are screenplay text.
 */
const IGNORED_CONTAINER_TAGS = new Set([
  'head',
  'noscript',
  'template',
  'iframe',
  'object',
  'svg',
  'canvas',
  'audio',
  'video',
  'map',
  'button',
  'select',
  'applet',
  'frame',
  'frameset',
]);

const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_TAGS = new Set(['i', 'em']);
const UNDERLINE_TAGS = new Set(['u', 'ins']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  euro: '€',
  deg: '°',
};

interface Frame {
  readonly tagName: string;
  readonly ignored: boolean;
}

/** One decoded block of screenplay text, with a source location for the report. */
interface HtmlBlock {
  readonly text: string;
  readonly heading: boolean;
  readonly start: number;
  readonly end: number;
}

export function importHtml(input: ScreenplayInput): ScreenplayImportResult {
  assertInputSize(input);
  const source = requireNonEmptySource(input);
  runHtmlPreflight(source);
  const blocks = tokenizeHtmlBlocks(source);
  const warnings = new Set<string>();
  const fountain = renderFountain(blocks, warnings);
  if (fountain.trim() === '') {
    throw new ScreenplayInterchangeError(
      'INVALID_HTML',
      'The HTML document contains no screenplay text.',
      { format: 'html' },
    );
  }
  return {
    fountain: `${fountain.replace(/\s+$/u, '')}\n`,
    sourceFormat: 'html',
    fidelity: 'lossy',
    warnings: [...warnings],
  };
}

function assertInputSize(input: ScreenplayInput): void {
  const byteLength =
    typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (byteLength <= MAX_HTML_BYTES) return;
  throw new ScreenplayInterchangeError(
    'INPUT_TOO_LARGE',
    `HTML files must not exceed ${MAX_HTML_BYTES.toLocaleString('en-US')} bytes.`,
    { format: 'html' },
  );
}

function runHtmlPreflight(source: string): void {
  try {
    assertHtmlPreflight(source, HTML_PREFLIGHT_LIMITS);
  } catch (error) {
    if (error instanceof HtmlPreflightError) {
      throw new ScreenplayInterchangeError(error.code, error.message, {
        format: 'html',
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Tokenizes the raw source into a flat sequence of text blocks. Every
 * block-level tag (open or close) flushes whatever inline text has
 * accumulated since the last flush, so `<div><p>text</p></div>` and bare
 * `<body>text</body>` both produce exactly one block - there is no separate
 * notion of "container" vs. "paragraph" tag to keep in sync.
 */
function tokenizeHtmlBlocks(source: string): HtmlBlock[] {
  return new HtmlTokenizer(source).run();
}

/**
 * Holds the tokenizer's mutable scan state and is split into small,
 * single-purpose methods purely to keep each one's branching shallow; the
 * overall algorithm is the single linear scan described on
 * {@link tokenizeHtmlBlocks}.
 */
class HtmlTokenizer {
  private readonly blocks: HtmlBlock[] = [];
  private readonly stack: Frame[] = [];
  private readonly emphasis = { bold: 0, italic: 0, underline: 0 };
  private buffer = '';
  private bufferStart = -1;
  private preDepth = 0;
  private headingDepth = 0;
  private cursor = 0;

  constructor(private readonly source: string) {}

  run(): HtmlBlock[] {
    while (this.cursor < this.source.length) this.step();
    this.flush(this.source.length);
    return this.blocks;
  }

  private step(): void {
    const { source } = this;
    const start = source.indexOf('<', this.cursor);
    if (start < 0) {
      if (!this.ignored()) this.append(decodeEntities(source.slice(this.cursor)));
      this.cursor = source.length;
      return;
    }
    if (!this.ignored() && start > this.cursor) {
      this.append(decodeEntities(source.slice(this.cursor, start)));
    }

    const skippedTo = trySkipNonElement(source, start);
    if (skippedTo !== undefined) {
      this.cursor = skippedTo;
      return;
    }
    this.consumeTag(start);
  }

  private consumeTag(start: number): void {
    const { source } = this;
    const end = tagEnd(source, start + 1);
    const closing = source[start + 1] === '/';
    const body = source.slice(start + (closing ? 2 : 1), end).trim();
    const tagName = tagNameOf(body);
    this.cursor = end + 1;

    if (closing) {
      this.handleClosingTag(tagName, start);
      return;
    }
    if (RAW_TEXT_ELEMENTS.has(tagName) && !body.endsWith('/')) {
      if (BLOCK_TAGS.has(tagName) && !this.ignored()) this.flush(start);
      this.cursor = skipRawText(source, this.cursor, tagName);
      return;
    }
    if (this.ignored()) {
      if (!VOID_ELEMENTS.has(tagName) && !body.endsWith('/')) {
        this.stack.push({ tagName, ignored: true });
      }
      return;
    }
    if (VOID_ELEMENTS.has(tagName)) {
      if (tagName === 'br') this.append('\n');
      else if (tagName === 'hr') this.flush(start);
      return;
    }
    this.handleOpeningTag(tagName, body, start);
  }

  private handleClosingTag(tagName: string, start: number): void {
    if (BLOCK_TAGS.has(tagName) && !this.ignored()) this.flush(start);
    if (tagName === 'pre') this.preDepth = Math.max(0, this.preDepth - 1);
    if (HEADING_TAGS.has(tagName)) this.headingDepth = Math.max(0, this.headingDepth - 1);
    popEmphasis(tagName, this.emphasis);
    popFrame(this.stack, tagName);
  }

  private handleOpeningTag(tagName: string, body: string, start: number): void {
    if (BLOCK_TAGS.has(tagName)) this.flush(start);
    if (tagName === 'pre') this.preDepth += 1;
    if (HEADING_TAGS.has(tagName)) this.headingDepth += 1;
    pushEmphasis(tagName, this.emphasis);

    const nowIgnored =
      IGNORED_CONTAINER_TAGS.has(tagName) || hasHiddenAttribute(body, tagName.length);
    if (!body.endsWith('/')) this.stack.push({ tagName, ignored: nowIgnored });
  }

  private flush(end: number): void {
    const collapsed = this.preDepth > 0 ? this.buffer : this.buffer.replace(/\s+/gu, ' ');
    const text = collapsed.trim();
    if (text !== '' && this.bufferStart >= 0) {
      this.blocks.push({
        text: text.slice(0, MAX_BLOCK_TEXT_LENGTH),
        heading: this.headingDepth > 0,
        start: this.bufferStart,
        end,
      });
    }
    this.buffer = '';
    this.bufferStart = -1;
  }

  private append(text: string): void {
    if (text === '') return;
    if (this.bufferStart < 0) this.bufferStart = this.cursor;
    this.buffer += wrapEmphasis(text, this.emphasis);
  }

  private ignored(): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1]!.ignored;
  }
}

/**
 * Skips a comment, CDATA section, processing instruction, or declaration
 * (including `<!DOCTYPE ...>`, already validated by {@link assertHtmlPreflight})
 * starting at `start`. Returns the cursor position just past it, or
 * `undefined` if `start` is not one of these.
 */
function trySkipNonElement(source: string, start: number): number | undefined {
  if (source.startsWith('<!--', start)) return skipTo(source, start + 4, '-->');
  if (source.startsWith('<![CDATA[', start)) return skipTo(source, start + 9, ']]>');
  if (source.startsWith('<?', start) || source.startsWith('<!', start)) {
    return skipTo(source, start + 1, '>');
  }
  return undefined;
}

function popFrame(stack: Frame[], tagName: string): void {
  // Lenient close: HTML tolerates mismatched/omitted closers. Pop the
  // nearest matching ancestor if one exists; otherwise leave the stack alone
  // rather than desynchronizing it on a stray close tag.
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!.tagName === tagName) {
      stack.length = index;
      return;
    }
  }
}

function pushEmphasis(
  tagName: string,
  emphasis: { bold: number; italic: number; underline: number },
): void {
  if (BOLD_TAGS.has(tagName)) emphasis.bold += 1;
  else if (ITALIC_TAGS.has(tagName)) emphasis.italic += 1;
  else if (UNDERLINE_TAGS.has(tagName)) emphasis.underline += 1;
}

function popEmphasis(
  tagName: string,
  emphasis: { bold: number; italic: number; underline: number },
): void {
  if (BOLD_TAGS.has(tagName)) emphasis.bold = Math.max(0, emphasis.bold - 1);
  else if (ITALIC_TAGS.has(tagName)) emphasis.italic = Math.max(0, emphasis.italic - 1);
  else if (UNDERLINE_TAGS.has(tagName)) emphasis.underline = Math.max(0, emphasis.underline - 1);
}

function wrapEmphasis(
  text: string,
  emphasis: { bold: number; italic: number; underline: number },
): string {
  let wrapped = text;
  if (emphasis.underline > 0) wrapped = `_${wrapped}_`;
  if (emphasis.italic > 0) wrapped = `*${wrapped}*`;
  if (emphasis.bold > 0) wrapped = `**${wrapped}**`;
  return wrapped;
}

function hasHiddenAttribute(body: string, tagNameLength: number): boolean {
  const attributes = body.slice(tagNameLength);
  return /(^|\s)hidden(\s|=|\/|$)/iu.test(attributes);
}

function tagNameOf(body: string): string {
  return (/^[a-zA-Z][a-zA-Z0-9-]*/u.exec(body)?.[0] ?? '').toLowerCase();
}

function tagEnd(source: string, from: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  throw new ScreenplayInterchangeError('MALFORMED_HTML', 'The HTML document is malformed.', {
    format: 'html',
  });
}

function skipTo(source: string, from: number, delimiter: string): number {
  const end = source.indexOf(delimiter, from);
  if (end >= 0) return end + delimiter.length;
  throw new ScreenplayInterchangeError('MALFORMED_HTML', 'The HTML document is malformed.', {
    format: 'html',
  });
}

function skipRawText(source: string, from: number, tagName: string): number {
  const needle = `</${tagName}`;
  const lowerNeedle = needle.toLowerCase();
  const limit = source.length - lowerNeedle.length;
  for (let index = from; index <= limit; index += 1) {
    let matches = true;
    for (let offset = 0; offset < lowerNeedle.length; offset += 1) {
      if (source[index + offset]?.toLowerCase() !== lowerNeedle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const closeEnd = source.indexOf('>', index);
      if (closeEnd < 0) break;
      return closeEnd + 1;
    }
  }
  throw new ScreenplayInterchangeError('MALFORMED_HTML', 'The HTML document is malformed.', {
    format: 'html',
  });
}

/**
 * Decodes a fixed, curated table of named entities plus numeric character
 * references. Unrecognized named entities are left as literal text rather
 * than dropped or expanded - there is no DTD-driven resolution here, so
 * nothing can recurse or blow up in size.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]{1,8}|#\d{1,8}|[a-zA-Z][a-zA-Z0-9]{1,31});/gu,
    (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return codePointToString(Number.parseInt(body.slice(2), 16)) ?? match;
      }
      if (body.startsWith('#')) {
        return codePointToString(Number.parseInt(body.slice(1), 10)) ?? match;
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function codePointToString(codePoint: number): string | undefined {
  if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return undefined;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '�';
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

function renderFountain(blocks: readonly HtmlBlock[], warnings: Set<string>): string {
  const writer = new FountainWriter();
  for (const block of blocks) classifyAndEmit(block, writer, warnings);
  return writer.toString();
}

function classifyAndEmit(block: HtmlBlock, writer: FountainWriter, warnings: Set<string>): void {
  const plain = stripEmphasisMarkup(block.text);
  const heading = matchSceneHeading(plain);
  if (heading || (block.heading && plain !== '')) {
    writer.block(heading ? plain : `.${plain}`);
    return;
  }
  const character = matchCharacter(plain);
  if (character && plain.length <= 60 && !writer.dialogueOpen) {
    writer.character(character.name + (character.extension ? ` ${character.extension}` : ''));
    return;
  }
  if (writer.dialogueOpen) {
    const isParenthetical = plain.startsWith('(') && plain.endsWith(')');
    const text = isParenthetical ? plain : block.text;
    if (writer.dialogueLine(text)) return;
  }
  if (isTransitionCandidate(plain)) {
    writer.block(plain);
    return;
  }
  writer.action(block.text);
  if (plain === plain.toUpperCase() && /\p{L}/u.test(plain) && plain.length <= 60) {
    warnings.add(
      'An upper-case HTML block that did not fit the surrounding dialogue structure was imported as action.',
    );
  }
}

function stripEmphasisMarkup(text: string): string {
  return text.replace(/\*\*|\*|_/gu, '');
}

class FountainWriter {
  private readonly lines: string[] = [];
  dialogueOpen = false;

  block(text: string): void {
    this.ensureBlank();
    this.lines.push(...text.split('\n'));
    this.dialogueOpen = false;
  }

  action(text: string): void {
    for (const line of text.split('\n')) {
      if (line !== '') this.block(`!${line}`);
    }
  }

  character(text: string): void {
    this.ensureBlank();
    const forced = text !== text.toUpperCase() ? `@${text}` : text;
    this.lines.push(forced);
    this.dialogueOpen = true;
  }

  dialogueLine(text: string): boolean {
    if (!this.dialogueOpen) return false;
    for (const line of text.split('\n')) this.lines.push(line);
    return true;
  }

  toString(): string {
    return this.lines.join('\n').trim();
  }

  private ensureBlank(): void {
    if (this.lines.length > 0 && this.lines.at(-1) !== '') this.lines.push('');
  }
}
