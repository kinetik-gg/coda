/**
 * Hardened HTML preflight, run on raw source text before any tokenizing.
 *
 * This is deliberately a sibling of {@link ../interchange/xml-preflight.ts},
 * not a reuse of it. Real HTML is not well-formed XML: void elements
 * (`<br>`, `<img>`, ...) never close, browsers tolerate unclosed optional
 * tags (`<p>`, `<li>`, ...), and every HTML5 document legitimately opens with
 * a bare `<!DOCTYPE html>` - which the XML preflight rejects outright as an
 * XXE vector. Reusing it as-is would reject nearly every real upload.
 *
 * The HTML tokenizer built on top of this preflight never resolves DTD
 * entities, so a bare `<!DOCTYPE html>` is harmless here and is tolerated.
 * What is not tolerated is a declaration carrying an internal subset
 * (`<!DOCTYPE html [ ... ]>`), because that bracketed region is exactly where
 * an `<!ENTITY>` billion-laughs payload lives; rather than trust it to be
 * small, it is rejected unconditionally, and a bare `<!ENTITY` anywhere is
 * rejected too as an extra guard.
 */

export type HtmlPreflightFailureCode = 'UNSAFE_HTML' | 'RESOURCE_LIMIT' | 'MALFORMED_HTML';

/** Thrown by {@link assertHtmlPreflight}. Callers translate `code` into their own error type. */
export class HtmlPreflightError extends Error {
  readonly code: HtmlPreflightFailureCode;

  constructor(code: HtmlPreflightFailureCode, message: string) {
    super(message);
    this.name = 'HtmlPreflightError';
    this.code = code;
  }
}

export interface HtmlPreflightLimits {
  /** Largest nesting depth of open elements the scan will tolerate. */
  readonly maxElementDepth: number;
  /** Largest number of element start tags the scan will tolerate. */
  readonly maxElementCount: number;
  /** Largest number of attributes a single tag may carry. */
  readonly maxAttributesPerElement: number;
}

/**
 * Elements that never close and never increase nesting depth. Matches the
 * HTML5 void-element list; anything else that ends a start tag with `/>`
 * (foreign/XML-style self-closing) is also treated as non-nesting.
 */
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
 * Content of these elements is raw text per the HTML spec: it is scanned only
 * for the literal closing tag, never tokenized as markup. `<script>` and
 * `<style>` are exactly the "active content" this scan must never interpret
 * as elements, so scanning their bodies as tags would both misclassify
 * ordinary code (`if (a < b)`) as markup and defeat the point of ignoring
 * them.
 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/** Bounds how far a single declaration/comment/PI scan is allowed to run before giving up. */
const MAX_DECLARATION_SCAN = 10_000;

/**
 * Rejects unsafe declarations, then walks the source once to enforce
 * nesting-depth, element-count, and per-element attribute-count ceilings.
 * Throws {@link HtmlPreflightError} on the first violation; never constructs a
 * DOM or a parse tree.
 */
export function assertHtmlPreflight(source: string, limits: HtmlPreflightLimits): void {
  const state = { depth: 0, elementCount: 0 };
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;

    const skippedTo = trySkipNonElementMarkup(source, start);
    if (skippedTo !== undefined) {
      cursor = skippedTo;
      continue;
    }

    cursor = consumeElementTag(source, start, state, limits);
  }
}

/**
 * Skips a comment, CDATA section, processing instruction, or declaration
 * (including `<!DOCTYPE ...>`) that starts at `start`. Returns the cursor
 * position just past it, or `undefined` if `start` is not one of these.
 */
function trySkipNonElementMarkup(source: string, start: number): number | undefined {
  if (source.startsWith('<!--', start)) return afterDelimited(source, start + 4, '-->');
  if (source.startsWith('<![CDATA[', start)) return afterDelimited(source, start + 9, ']]>');
  if (source.startsWith('<?', start)) return afterDelimited(source, start + 2, '?>');
  if (source.startsWith('<!', start)) return assertDeclaration(source, start);
  return undefined;
}

interface PreflightState {
  depth: number;
  elementCount: number;
}

/** Consumes one start or end tag at `start`, enforcing every per-element ceiling. */
function consumeElementTag(
  source: string,
  start: number,
  state: PreflightState,
  limits: HtmlPreflightLimits,
): number {
  const end = htmlTagEnd(source, start + 1);
  const closing = source[start + 1] === '/';
  const body = source.slice(start + (closing ? 2 : 1), end).trim();
  if (closing) {
    state.depth = Math.max(0, state.depth - 1);
    return end + 1;
  }

  const tagName = tagNameOf(body);
  state.elementCount += 1;
  if (state.elementCount > limits.maxElementCount) resourceLimit('element count');
  assertAttributeCount(body, limits);

  if (RAW_TEXT_ELEMENTS.has(tagName) && !body.endsWith('/')) {
    return skipRawText(source, end + 1, tagName);
  }
  if (!body.endsWith('/') && !VOID_ELEMENTS.has(tagName)) {
    state.depth += 1;
    if (state.depth > limits.maxElementDepth) resourceLimit('element depth');
  }
  return end + 1;
}

function tagNameOf(body: string): string {
  return (/^[a-zA-Z][a-zA-Z0-9-]*/u.exec(body)?.[0] ?? '').toLowerCase();
}

function assertAttributeCount(body: string, limits: HtmlPreflightLimits): void {
  let count = 0;
  let quote: '"' | "'" | undefined;
  let inToken = false;
  let index = 0;
  while (index < body.length && /[a-zA-Z0-9-]/u.test(body[index] ?? '')) index += 1;

  for (; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '=' || character === '/') continue;
    if (character !== undefined && /\s/u.test(character)) {
      inToken = false;
      continue;
    }
    if (!inToken) {
      inToken = true;
      count += 1;
      if (count > limits.maxAttributesPerElement) resourceLimit('attribute count');
    }
  }
}

function assertDeclaration(source: string, start: number): number {
  if (source.slice(start, start + 8).toUpperCase() === '<!ENTITY') {
    throw new HtmlPreflightError(
      'UNSAFE_HTML',
      'The document contains an entity declaration, which is not accepted.',
    );
  }
  const scanLimit = Math.min(source.length, start + MAX_DECLARATION_SCAN);
  let cursor = start + 2;
  while (cursor < scanLimit) {
    const character = source[cursor];
    if (character === '[') {
      throw new HtmlPreflightError(
        'UNSAFE_HTML',
        'The document contains a declaration with an internal subset, which is not accepted.',
      );
    }
    if (character === '>') return cursor + 1;
    cursor += 1;
  }
  throw new HtmlPreflightError(
    'MALFORMED_HTML',
    'The HTML document contains an unterminated declaration.',
  );
}

function afterDelimited(source: string, from: number, delimiter: string): number {
  const end = source.indexOf(delimiter, from);
  if (end >= 0) return end + delimiter.length;
  throw new HtmlPreflightError('MALFORMED_HTML', 'The HTML document is malformed.');
}

/**
 * Raw-text elements (`<script>`, `<style>`, `<textarea>`, `<title>`) are
 * scanned only for their literal closing tag, per the HTML spec, so their
 * content is never mistaken for markup.
 */
function skipRawText(source: string, from: number, tagName: string): number {
  const needle = `</${tagName}`;
  const closerStart = indexOfAsciiCaseInsensitive(source, needle, from);
  if (closerStart < 0) {
    throw new HtmlPreflightError('MALFORMED_HTML', 'The HTML document is malformed.');
  }
  const closerEnd = source.indexOf('>', closerStart);
  if (closerEnd < 0) {
    throw new HtmlPreflightError('MALFORMED_HTML', 'The HTML document is malformed.');
  }
  return closerEnd + 1;
}

/**
 * A single-pass, ASCII-only case-insensitive search. Deliberately avoids
 * `source.toLowerCase()`, which would allocate a full lowercase copy of the
 * document on every raw-text element - quadratic work on a document with many
 * `<script>`/`<style>` tags - and, for a handful of Unicode code points, can
 * change string length under full Unicode case folding and desynchronize
 * offsets from the original source.
 */
function indexOfAsciiCaseInsensitive(source: string, needle: string, from: number): number {
  const lowerNeedle = needle.toLowerCase();
  const limit = source.length - lowerNeedle.length;
  outer: for (let index = Math.max(from, 0); index <= limit; index += 1) {
    for (let offset = 0; offset < lowerNeedle.length; offset += 1) {
      const character = source[index + offset];
      if (character?.toLowerCase() !== lowerNeedle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function htmlTagEnd(source: string, from: number): number {
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
  throw new HtmlPreflightError('MALFORMED_HTML', 'The HTML document is malformed.');
}

function resourceLimit(resource: string): never {
  throw new HtmlPreflightError(
    'RESOURCE_LIMIT',
    `The HTML document exceeds the supported ${resource}.`,
  );
}
