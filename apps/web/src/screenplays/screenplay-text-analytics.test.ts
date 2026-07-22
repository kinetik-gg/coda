import { parseFountain } from '@coda/fountain';
import { describe, expect, it } from 'vitest';
import { analyzeRepeatedText, buildReadingEstimates } from './screenplay-text-analytics';

describe('screenplay text analytics', () => {
  it('ranks normalized repeated words and phrases deterministically', () => {
    const source = `INT. ROOM - DAY

Blue light, blue light. Red light, red light. 42 42 an an.
`;
    const result = analyzeRepeatedText(parseFountain(source).elements);

    expect(result.repeatedWords.map(({ text, count }) => ({ text, count }))).toEqual([
      { text: 'light', count: 4 },
      { text: 'blue', count: 2 },
      { text: 'red', count: 2 },
    ]);
    expect(result.repeatedPhrases).toContainEqual(
      expect.objectContaining({ text: 'blue light', count: 2, kind: 'phrase' }),
    );
    expect(result.repeatedWords.some(({ text }) => text === '42' || text === 'an')).toBe(false);
  });

  it('uses fixed, documented reading and speaking rates', () => {
    expect(buildReadingEstimates(400, 260)).toEqual({
      estimatedReadingMinutes: 2,
      estimatedDialogueMinutes: 2,
      readingWordsPerMinute: 200,
      speakingWordsPerMinute: 130,
    });
    expect(buildReadingEstimates(0, 0)).toMatchObject({
      estimatedReadingMinutes: 0,
      estimatedDialogueMinutes: 0,
    });
  });
});
