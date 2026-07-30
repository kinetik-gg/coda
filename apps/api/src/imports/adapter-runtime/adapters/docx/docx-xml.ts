/**
 * The XML half of DOCX hardening: one place that decodes an OOXML part, runs
 * the shared preflight over its raw text, and walks it with `sax`.
 *
 * A DOCX is hostile at two layers. `docx-package.ts` bounds the archive; this
 * module bounds what comes out of it. Both guards below run on *every* part the
 * adapter reads — `[Content_Types].xml`, both relationship parts, the styles and
 * numbering parts, and `word/document.xml` — not just the main document, because
 * an entity bomb in `word/numbering.xml` expands exactly as well as one in the
 * body.
 *
 * `assertXmlPreflight` (`packages/fountain/src/interchange/xml-preflight.ts`,
 * extracted by #246 for this use) scans raw source text before any parser
 * touches it: `<!DOCTYPE`/`<!ENTITY` are rejected outright, and nesting depth and
 * element count are bounded. `sax` is then the second line — the ADR measured it
 * rejecting the billion-laughs fixture with "Invalid character entity" because it
 * implements no DTD or general-entity expansion at all, and `strictEntities`
 * below narrows it further to the five predefined entities plus numeric
 * character references.
 */
import { ScreenplayAdapterAbortError, ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext, ScreenplayAdapterLimits } from '@coda/contracts';
import { assertXmlPreflight, XmlPreflightError } from '@coda/fountain';
import { parser as createSaxParser } from 'sax';
import type { SaxParser, SaxTag } from 'sax';

/**
 * WordprocessingML nests shallowly in practice — a run inside a hyperlink inside
 * a paragraph inside a table cell inside a table inside the body is about ten
 * levels. 100 leaves generous headroom for nested tables and textboxes while
 * still refusing a document whose only purpose is depth.
 */
export const DOCX_MAX_XML_ELEMENT_DEPTH = 100;

/**
 * How much source text is fed to `sax` between cooperative yields. Small enough
 * that a 20 MB part checks the deadline hundreds of times, large enough that the
 * yields themselves are not the cost.
 */
const XML_CHUNK_CHARACTERS = 65_536;

/**
 * Preflight ceilings for a part, derived from the run's configured limits rather
 * than invented here. `maxElements` is the report's element ceiling; an OOXML
 * part legitimately carries far more XML elements than it produces report
 * entries (a single paragraph is a `w:p`, a `w:pPr`, a `w:pStyle`, several
 * `w:r`/`w:rPr`/`w:t`), so the XML ceiling is a multiple of it.
 */
export function docxXmlPreflightLimits(limits: ScreenplayAdapterLimits): {
  maxElementDepth: number;
  maxElementCount: number;
} {
  return {
    maxElementDepth: DOCX_MAX_XML_ELEMENT_DEPTH,
    maxElementCount: limits.maxElements * 20,
  };
}

/** Strips a namespace prefix: `w:pStyle` -> `pStyle`. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** Reads an attribute by local name, so a package using a different prefix still parses. */
export function attributeValue(tag: SaxTag, wanted: string): string | undefined {
  const direct = tag.attributes[`w:${wanted}`] ?? tag.attributes[wanted];
  if (direct !== undefined) return direct;
  for (const [name, value] of Object.entries(tag.attributes)) {
    if (localName(name) === wanted) return value;
  }
  return undefined;
}

/**
 * Decodes a part's bytes as UTF-8 and preflights the result.
 *
 * `fatal: false` is deliberate: a lone bad byte in an otherwise valid package
 * should degrade to U+FFFD rather than fail the import, and every structural
 * decision after this point is made on element names the preflight and `sax`
 * both validate.
 */
export function decodeXmlPart(
  partName: string,
  bytes: Buffer,
  limits: ScreenplayAdapterLimits,
): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/u, '');
  try {
    assertXmlPreflight(text, docxXmlPreflightLimits(limits));
  } catch (error) {
    if (error instanceof XmlPreflightError) {
      throw new ScreenplayAdapterSourceError(`${partName}: ${error.message}`);
    }
    throw error;
  }
  return text;
}

export interface DocxXmlHandlers {
  onOpen?(tag: SaxTag, local: string): void;
  onClose?(local: string): void;
  onText?(text: string): void;
}

function createPartParser(partName: string, handlers: DocxXmlHandlers): SaxParser {
  const parser = createSaxParser(true, {
    trim: false,
    normalize: false,
    lowercase: false,
    xmlns: false,
    position: false,
    strictEntities: true,
  });
  parser.ondoctype = (): never => {
    // Unreachable while the preflight runs first; kept so this walker is safe on
    // its own terms rather than only in the order the adapter happens to call it.
    throw new ScreenplayAdapterSourceError(`${partName}: document type declarations are rejected.`);
  };
  parser.onopentag = (tag: SaxTag): void => handlers.onOpen?.(tag, localName(tag.name));
  parser.onclosetag = (name: string): void => handlers.onClose?.(localName(name));
  parser.ontext = (text: string): void => handlers.onText?.(text);
  parser.oncdata = (text: string): void => handlers.onText?.(text);
  return parser;
}

/**
 * Streams a part through `sax` in bounded chunks, checking the soft deadline and
 * yielding to the event loop between them.
 *
 * The macrotask yield matters more than it looks: the runtime's soft deadline is
 * a `setTimeout`, so an adapter that only awaits already-resolved promises drains
 * microtasks forever and never lets that timer fire. It would then be hard
 * `terminate()`d by the host instead of reporting an attributable `timeout`.
 */
export async function parseXmlPart(
  partName: string,
  xml: string,
  handlers: DocxXmlHandlers,
  context: ScreenplayAdapterContext,
): Promise<void> {
  let saxError: Error | undefined;
  const parser = createPartParser(partName, handlers);
  parser.onerror = (error: Error): void => {
    saxError ??= error;
  };
  for (let cursor = 0; cursor < xml.length; cursor += XML_CHUNK_CHARACTERS) {
    context.throwIfCancelled();
    writeChunk(parser, xml.slice(cursor, cursor + XML_CHUNK_CHARACTERS), partName, saxError);
    if (saxError) throw malformed(partName, saxError);
    await new Promise((resolve) => setImmediate(resolve));
  }
  context.throwIfCancelled();
  writeChunk(parser, undefined, partName, saxError);
  if (saxError) throw malformed(partName, saxError);
}

/**
 * `sax` records the first error and rethrows it from the *next* write, so both
 * the recorded error and a thrown one have to be handled. A `ScreenplayAdapter*`
 * error thrown by a handler is the walker's own decision (a cap was reached,
 * or the run was cancelled) and must propagate unchanged.
 */
function writeChunk(
  parser: SaxParser,
  chunk: string | undefined,
  partName: string,
  recorded: Error | undefined,
): void {
  if (recorded) return;
  try {
    if (chunk === undefined) parser.close();
    else parser.write(chunk);
  } catch (error) {
    if (error instanceof ScreenplayAdapterSourceError) throw error;
    if (error instanceof ScreenplayAdapterAbortError) throw error;
    throw malformed(partName, error instanceof Error ? error : new Error('XML parse failed'));
  }
}

function malformed(partName: string, error: Error): ScreenplayAdapterSourceError {
  return new ScreenplayAdapterSourceError(
    `${partName}: the XML could not be parsed (${error.message.split('\n')[0]}).`,
  );
}
