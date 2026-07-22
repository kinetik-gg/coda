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
