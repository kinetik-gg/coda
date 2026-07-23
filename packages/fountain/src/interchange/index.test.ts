import { describe, expect, it } from 'vitest';
import { importScreenplay, SCREENPLAY_FORMAT_CAPABILITIES } from './index';
import { ScreenplayInterchangeError } from './types';

describe('screenplay interchange facade', () => {
  it('passes native Fountain through without altering it', () => {
    const source = 'INT. ROOM - DAY\r\n\r\nAction.';
    expect(importScreenplay(source, { filename: 'draft.fountain' })).toEqual({
      fountain: source,
      sourceFormat: 'fountain',
      fidelity: 'native',
      warnings: [],
    });
  });

  it('preserves a UTF-8 BOM and every native line-ending byte as source text', () => {
    const source = '\uFEFFINT. ROOM - DAY\r\n\r\nAction.  ';
    const bytes = new TextEncoder().encode(source);
    expect(importScreenplay(bytes, { filename: 'draft.fountain' }).fountain).toBe(source);
  });

  it('rejects malformed UTF-8 and UTF-16 Fountain instead of replacing text', () => {
    expect(() =>
      importScreenplay(new Uint8Array([0xc3, 0x28]), { filename: 'draft.fountain' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(() =>
      importScreenplay(new Uint8Array([0xff, 0xfe, 0x49, 0x00]), {
        filename: 'draft.fountain',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ENCODING' }));
  });

  it('rejects unpaired UTF-16 surrogates supplied as strings', () => {
    expect(() =>
      importScreenplay('INT. ROOM - DAY\n\ud800', { filename: 'draft.fountain' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ENCODING' }));
  });

  it('safely forces plain text to action instead of guessing structure', () => {
    expect(importScreenplay('HELLO\nordinary words', { format: 'plain-text' })).toMatchObject({
      fountain: '!HELLO\n\n!ordinary words',
      sourceFormat: 'plain-text',
      fidelity: 'lossy',
    });
  });

  it('surfaces unsupported proprietary formats with actionable metadata', () => {
    expect(() => importScreenplay('payload', { filename: 'movie.fadein' })).toThrowError(
      ScreenplayInterchangeError,
    );
    const fadeIn = SCREENPLAY_FORMAT_CAPABILITIES.find((entry) => entry.format === 'fade-in');
    expect(fadeIn).toMatchObject({ canImport: false, canExport: false, fidelity: 'unsupported' });
    expect(fadeIn?.limitations[0]).toContain('export Fountain or FDX first');
  });
});
