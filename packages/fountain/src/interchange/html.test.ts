import { describe, expect, it } from 'vitest';
import { ScreenplayInterchangeError } from './types';
import { importHtml, MAX_HTML_BYTES } from './html';

describe('importHtml', () => {
  it('converts screenplay-like HTML to Fountain', () => {
    const result = importHtml(
      '<html><body>' +
        '<h1>INT. CAFE - NIGHT</h1>' +
        '<p>Rain falls against the window.</p>' +
        '<p>RILEY</p>' +
        '<p>We should go.</p>' +
        '<p>CUT TO:</p>' +
        '</body></html>',
    );
    expect(result.sourceFormat).toBe('html');
    expect(result.fidelity).toBe('lossy');
    expect(result.fountain).toContain('INT. CAFE - NIGHT');
    expect(result.fountain).toContain('RILEY');
    expect(result.fountain).toContain('We should go.');
    expect(result.fountain).toContain('CUT TO:');
  });

  it('never uses network or resource loads: img/link/script/style are inert text-free tags', () => {
    const result = importHtml(
      '<html><head><link rel="stylesheet" href="https://evil.example/x.css">' +
        '<script src="https://evil.example/x.js"></script></head>' +
        '<body><img src="https://evil.example/x.png">' +
        '<p>INT. ROOM - DAY</p><p>Action line.</p></body></html>',
    );
    expect(result.fountain).not.toContain('evil.example');
    expect(result.fountain).toContain('INT. ROOM - DAY');
  });

  it('ignores script and style content, including markup-like text inside them', () => {
    const result = importHtml(
      '<script>if (a < b) { document.write("<p>INJECTED</p>"); }</script>' +
        '<style>.x::before { content: "<p>ALSO INJECTED</p>"; }</style>' +
        '<p>Real action.</p>',
    );
    expect(result.fountain).not.toContain('INJECTED');
    expect(result.fountain).toContain('Real action.');
  });

  it('ignores hidden content', () => {
    const result = importHtml('<div hidden><p>SHOULD NOT APPEAR</p></div><p>Visible action.</p>');
    expect(result.fountain).not.toContain('SHOULD NOT APPEAR');
    expect(result.fountain).toContain('Visible action.');
  });

  it('decodes named and numeric entities', () => {
    const result = importHtml('<p>Caf&eacute; &amp; bar &#8212; &#x2014; end.</p>');
    expect(result.fountain).toContain('Café & bar — — end.');
  });

  it('leaves unrecognized named entities as literal text rather than expanding or dropping them', () => {
    const result = importHtml('<p>Some &unknownentity; text.</p>');
    expect(result.fountain).toContain('&unknownentity;');
  });

  it('maps bold, italic, and underline to Fountain emphasis markers', () => {
    const result = importHtml(
      '<p>RILEY</p><p><strong>Loud</strong> and <em>quiet</em> and <u>underlined</u>.</p>',
    );
    expect(result.fountain).toContain('**Loud**');
    expect(result.fountain).toContain('*quiet*');
    expect(result.fountain).toContain('_underlined_');
  });

  it('tolerates malformed nesting and unclosed optional tags', () => {
    const result = importHtml(
      '<p>INT. HOUSE - DAY<p>Unclosed paragraph one.<div><p>Nested without closing div.',
    );
    expect(result.fountain).toContain('INT. HOUSE - DAY');
    expect(result.fountain).toContain('Unclosed paragraph one.');
    expect(result.fountain).toContain('Nested without closing div.');
  });

  it('tolerates a bare HTML5 doctype', () => {
    const result = importHtml('<!DOCTYPE html><html><body><p>Action.</p></body></html>');
    expect(result.fountain).toContain('Action.');
  });

  it('produces deterministic output across repeated conversions', () => {
    const source = '<p>INT. ROOM - DAY</p><p>RILEY</p><p>Hello.</p>';
    expect(importHtml(source).fountain).toBe(importHtml(source).fountain);
  });

  it('rejects a doctype carrying an internal subset before any tokenizing', () => {
    expect(() =>
      importHtml('<!DOCTYPE html [<!ENTITY x "y">]><html><body><p>x</p></body></html>'),
    ).toThrow(ScreenplayInterchangeError);
  });

  it('rejects excessive nesting depth as a resource limit', () => {
    const nested = '<div>'.repeat(200);
    const closing = '</div>'.repeat(200);
    expect(() => importHtml(`${nested}<p>x</p>${closing}`)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects an oversized document', () => {
    const oversized = `<p>${'x'.repeat(MAX_HTML_BYTES)}</p>`;
    expect(() => importHtml(oversized)).toThrowError(
      expect.objectContaining({ code: 'INPUT_TOO_LARGE' }),
    );
  });

  it('rejects a document with no screenplay text', () => {
    expect(() => importHtml('<html><head><title>Empty</title></head><body></body></html>')).toThrow(
      ScreenplayInterchangeError,
    );
  });

  it('rejects an unterminated tag as malformed', () => {
    expect(() => importHtml('<p>Text<div')).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_HTML' }),
    );
  });

  it('keeps dialogue attached to the preceding character cue', () => {
    const result = importHtml(
      '<p>INT. ROOM - DAY</p><p>RILEY</p><p>(quietly)</p><p>We should go.</p>',
    );
    const lines = result.fountain.split('\n').map((line) => line.trim());
    const cueIndex = lines.indexOf('RILEY');
    expect(cueIndex).toBeGreaterThanOrEqual(0);
    expect(lines[cueIndex + 1]).toBe('(quietly)');
    expect(lines[cueIndex + 2]).toBe('We should go.');
  });
});
