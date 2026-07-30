/**
 * Hardened XML preflight, shared by every XML-bearing import adapter.
 *
 * The scan below runs on the raw source text, before any DOM is constructed.
 * That ordering is the actual security property: a `DOMParser` is never handed
 * bytes that declare a document type or an entity, and never handed bytes deep
 * or numerous enough to be a resource-exhaustion attempt. Extracted from the
 * Final Draft importer (#246) so DOCX's per-part XML (#248) and any other
 * XML-based adapter can apply the same guard without re-deriving it.
 */

const UNSAFE_XML_DECLARATION = /<!DOCTYPE|<!ENTITY/iu;

export interface XmlPreflightLimits {
  /** Largest nesting depth of open elements the scan will tolerate. */
  readonly maxElementDepth: number;
  /** Largest number of element start tags the scan will tolerate. */
  readonly maxElementCount: number;
}

export type XmlPreflightFailureCode = 'UNSAFE_XML' | 'RESOURCE_LIMIT' | 'MALFORMED_XML';

/** Thrown by {@link assertXmlPreflight}. Callers translate `code` into their own error type. */
export class XmlPreflightError extends Error {
  readonly code: XmlPreflightFailureCode;

  constructor(code: XmlPreflightFailureCode, message: string) {
    super(message);
    this.name = 'XmlPreflightError';
    this.code = code;
  }
}

/**
 * Rejects a document type or entity declaration, then walks the source once to
 * reject any other declaration-like markup and enforce nesting-depth and
 * element-count ceilings. Throws {@link XmlPreflightError} on the first
 * violation; never constructs a DOM.
 */
export function assertXmlPreflight(source: string, limits: XmlPreflightLimits): void {
  if (UNSAFE_XML_DECLARATION.test(source)) {
    throw new XmlPreflightError(
      'UNSAFE_XML',
      'The document contains a document type or entity declaration, which is not accepted.',
    );
  }
  assertXmlComplexity(source, limits);
}

function assertXmlComplexity(source: string, limits: XmlPreflightLimits): void {
  let cursor = 0;
  let depth = 0;
  let elementCount = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      cursor = afterDelimited(source, start + 4, '-->');
      continue;
    }
    if (source.startsWith('<![CDATA[', start)) {
      cursor = afterDelimited(source, start + 9, ']]>');
      continue;
    }
    if (source.startsWith('<?', start)) {
      cursor = afterDelimited(source, start + 2, '?>');
      continue;
    }
    const end = xmlTagEnd(source, start + 1);
    const body = source.slice(start + 1, end).trim();
    if (body.startsWith('!')) {
      throw new XmlPreflightError(
        'UNSAFE_XML',
        'The document contains a declaration outside a comment or CDATA section, which is not accepted.',
      );
    }
    if (body.startsWith('/')) {
      depth = Math.max(0, depth - 1);
      cursor = end + 1;
      continue;
    }

    elementCount += 1;
    if (elementCount > limits.maxElementCount) resourceLimit('element count');
    if (!body.endsWith('/')) {
      depth += 1;
      if (depth > limits.maxElementDepth) resourceLimit('element depth');
    }
    cursor = end + 1;
  }
}

function afterDelimited(source: string, from: number, delimiter: string): number {
  const end = source.indexOf(delimiter, from);
  if (end >= 0) return end + delimiter.length;
  throw new XmlPreflightError('MALFORMED_XML', 'The XML document is malformed.');
}

function xmlTagEnd(source: string, from: number): number {
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
  throw new XmlPreflightError('MALFORMED_XML', 'The XML document is malformed.');
}

function resourceLimit(resource: string): never {
  throw new XmlPreflightError(
    'RESOURCE_LIMIT',
    `The XML document exceeds the supported ${resource}.`,
  );
}
