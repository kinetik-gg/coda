import { describe, expect, it } from 'vitest';
import {
  chunkScreenplayGraphemes,
  screenplayGraphemeCount,
  screenplayGraphemes,
} from './screenplay-graphemes';

describe('screenplay graphemes', () => {
  it('keeps combining marks, emoji modifiers, and ZWJ sequences intact', () => {
    const value = 'e\u0301 👍🏽 👩‍🚀';
    expect(screenplayGraphemes(value).map(({ text }) => text)).toEqual([
      'e\u0301',
      ' ',
      '👍🏽',
      ' ',
      '👩‍🚀',
    ]);
    expect(screenplayGraphemeCount(value)).toBe(5);
  });

  it('chunks by grapheme cells without splitting UTF-16 sequences', () => {
    expect(chunkScreenplayGraphemes('A👩‍🚀e\u0301B', 2)).toEqual(['A👩‍🚀', 'e\u0301B']);
  });
});
