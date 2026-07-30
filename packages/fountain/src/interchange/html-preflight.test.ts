import { describe, expect, it } from 'vitest';
import { assertHtmlPreflight, HtmlPreflightError } from './html-preflight';

const LIMITS = { maxElementDepth: 8, maxElementCount: 8, maxAttributesPerElement: 4 };

describe('assertHtmlPreflight', () => {
  it('accepts a small, well-formed document', () => {
    expect(() => assertHtmlPreflight('<div><p>text</p></div>', LIMITS)).not.toThrow();
  });

  it('tolerates a bare HTML5 doctype', () => {
    expect(() =>
      assertHtmlPreflight('<!DOCTYPE html><html><body>text</body></html>', LIMITS),
    ).not.toThrow();
  });

  it('tolerates void elements without a matching close tag', () => {
    expect(() =>
      assertHtmlPreflight('<p>Line one<br>Line two<img src="x"></p>', LIMITS),
    ).not.toThrow();
  });

  it('rejects a doctype carrying an internal subset', () => {
    expect(() =>
      assertHtmlPreflight('<!DOCTYPE html [<!ENTITY x "y">]><html></html>', LIMITS),
    ).toThrowError(expect.objectContaining({ code: 'UNSAFE_HTML' }));
  });

  it('rejects a bare entity declaration', () => {
    expect(() => assertHtmlPreflight('<div><!ENTITY x "y"></div>', LIMITS)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_HTML' }),
    );
  });

  it('ignores markup-like text inside comments, CDATA, and script/style bodies', () => {
    const source =
      '<!-- <p><p><p> --><script>if (a < b) { document.write("<p><p><p>"); }</script>' +
      '<style>.x { content: "<p></p>"; }</style><p>real text</p>';
    expect(() => assertHtmlPreflight(source, LIMITS)).not.toThrow();
  });

  it('is case-insensitive when matching a raw-text closing tag', () => {
    expect(() => assertHtmlPreflight('<SCRIPT>1 < 2</SCRIPT><p>ok</p>', LIMITS)).not.toThrow();
  });

  it('rejects excessive nesting depth', () => {
    const nested = '<div>'.repeat(LIMITS.maxElementDepth + 1);
    const closing = '</div>'.repeat(LIMITS.maxElementDepth + 1);
    expect(() => assertHtmlPreflight(`${nested}${closing}`, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('does not count void elements toward nesting depth', () => {
    const wideLimits = { ...LIMITS, maxElementCount: 100 };
    expect(() =>
      assertHtmlPreflight('<br>'.repeat(LIMITS.maxElementDepth + 5), wideLimits),
    ).not.toThrow();
  });

  it('rejects excessive element count', () => {
    const elements = '<br>'.repeat(LIMITS.maxElementCount + 1);
    expect(() => assertHtmlPreflight(elements, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects excessive attribute counts on a single element', () => {
    const attributes = Array.from(
      { length: LIMITS.maxAttributesPerElement + 1 },
      (_, i) => `a${i}="1"`,
    ).join(' ');
    expect(() => assertHtmlPreflight(`<div ${attributes}></div>`, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects unterminated tags as malformed', () => {
    expect(() => assertHtmlPreflight('<div', LIMITS)).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_HTML' }),
    );
  });

  it('rejects an unterminated script body as malformed', () => {
    expect(() => assertHtmlPreflight('<script>var x = 1;', LIMITS)).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_HTML' }),
    );
  });

  it('throws a named, catchable error', () => {
    try {
      assertHtmlPreflight('<!DOCTYPE html [<!ENTITY x "y">]>', LIMITS);
      throw new Error('expected assertHtmlPreflight to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlPreflightError);
      expect((error as HtmlPreflightError).name).toBe('HtmlPreflightError');
    }
  });
});
