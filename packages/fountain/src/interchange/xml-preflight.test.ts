import { describe, expect, it } from 'vitest';
import { assertXmlPreflight, XmlPreflightError } from './xml-preflight';

const LIMITS = { maxElementDepth: 8, maxElementCount: 8 };

describe('assertXmlPreflight', () => {
  it('accepts a small, well-formed document', () => {
    expect(() => assertXmlPreflight('<a><b>text</b></a>', LIMITS)).not.toThrow();
  });

  it('rejects a DOCTYPE declaration before any DOM would be constructed', () => {
    expect(() =>
      assertXmlPreflight('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', LIMITS),
    ).toThrowError(expect.objectContaining({ code: 'UNSAFE_XML' }));
  });

  it('rejects an entity declaration', () => {
    expect(() => assertXmlPreflight('<a><!ENTITY x "y"></a>', LIMITS)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_XML' }),
    );
  });

  it('ignores markup-like text inside comments, CDATA, and processing instructions', () => {
    const source = '<?xml-stylesheet href="x"?><!-- <Paragraph> --><a><![CDATA[<b><c><d>]]></a>';
    expect(() => assertXmlPreflight(source, LIMITS)).not.toThrow();
  });

  it('rejects excessive nesting depth', () => {
    const nested = '<a>'.repeat(LIMITS.maxElementDepth + 1);
    const closing = '</a>'.repeat(LIMITS.maxElementDepth + 1);
    expect(() => assertXmlPreflight(`${nested}${closing}`, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects excessive element count', () => {
    const elements = '<a/>'.repeat(LIMITS.maxElementCount + 1);
    expect(() => assertXmlPreflight(elements, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects unterminated tags as malformed', () => {
    expect(() => assertXmlPreflight('<a', LIMITS)).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_XML' }),
    );
  });

  it('throws a named, catchable error', () => {
    try {
      assertXmlPreflight('<!DOCTYPE a>', LIMITS);
      throw new Error('expected assertXmlPreflight to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(XmlPreflightError);
      expect((error as XmlPreflightError).name).toBe('XmlPreflightError');
    }
  });
});
