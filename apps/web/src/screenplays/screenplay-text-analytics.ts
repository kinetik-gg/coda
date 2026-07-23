import type { FountainElement } from '@coda/fountain';
import { round } from './screenplay-statistics-math';

export const SCREENPLAY_READING_WORDS_PER_MINUTE = 200;
export const SCREENPLAY_SPEAKING_WORDS_PER_MINUTE = 130;

export interface ScreenplayRepeatedTextStatistic {
  id: string;
  text: string;
  count: number;
  kind: 'word' | 'phrase';
  sourceOffset: number;
}

export interface ScreenplayReadingEstimates {
  /** Silent reading estimate at 200 words per minute. */
  estimatedReadingMinutes: number;
  /** Spoken-dialogue estimate at 130 words per minute. */
  estimatedDialogueMinutes: number;
  readingWordsPerMinute: typeof SCREENPLAY_READING_WORDS_PER_MINUTE;
  speakingWordsPerMinute: typeof SCREENPLAY_SPEAKING_WORDS_PER_MINUTE;
}

interface CountedText {
  count: number;
  sourceOffset: number;
}

interface SourceToken {
  normalized: string;
  sourceOffset: number;
}

const analyzedKinds = new Set<FountainElement['kind']>(['action', 'centered', 'dialogue', 'lyric']);

export function analyzeRepeatedText(elements: readonly FountainElement[]): {
  repeatedWords: ScreenplayRepeatedTextStatistic[];
  repeatedPhrases: ScreenplayRepeatedTextStatistic[];
} {
  const wordCounts = new Map<string, CountedText>();
  const phraseCounts = new Map<string, CountedText>();
  for (const element of elements) {
    if (!analyzedKinds.has(element.kind) || !('text' in element)) continue;
    const tokens = sourceTokens(element);
    recordWords(tokens, wordCounts);
    recordPhrases(tokens, phraseCounts);
  }
  return {
    repeatedWords: rankedRepeatedText(wordCounts, 'word', 15),
    repeatedPhrases: rankedRepeatedText(phraseCounts, 'phrase', 12),
  };
}

export function buildReadingEstimates(
  totalWords: number,
  dialogueWords: number,
): ScreenplayReadingEstimates {
  return Object.freeze({
    estimatedReadingMinutes: round(totalWords / SCREENPLAY_READING_WORDS_PER_MINUTE, 2),
    estimatedDialogueMinutes: round(dialogueWords / SCREENPLAY_SPEAKING_WORDS_PER_MINUTE, 2),
    readingWordsPerMinute: SCREENPLAY_READING_WORDS_PER_MINUTE,
    speakingWordsPerMinute: SCREENPLAY_SPEAKING_WORDS_PER_MINUTE,
  });
}

function sourceTokens(element: FountainElement): SourceToken[] {
  if (!('text' in element)) return [];
  const textOffset = Math.max(0, element.raw.indexOf(element.text));
  return [...element.text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].flatMap((match) => {
    const text = match[0];
    const normalized = normalizeToken(text);
    return normalized
      ? [{ normalized, sourceOffset: element.start + textOffset + (match.index ?? 0) }]
      : [];
  });
}

function normalizeToken(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase();
  return normalized.length >= 3 && !/^\d+$/u.test(normalized) ? normalized : '';
}

function recordWords(tokens: readonly SourceToken[], counts: Map<string, CountedText>): void {
  for (const token of tokens) increment(counts, token.normalized, token.sourceOffset);
}

function recordPhrases(tokens: readonly SourceToken[], counts: Map<string, CountedText>): void {
  for (const size of [2, 3]) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const phraseTokens = tokens.slice(index, index + size);
      const phrase = phraseTokens.map(({ normalized }) => normalized).join(' ');
      increment(counts, phrase, phraseTokens[0]?.sourceOffset ?? 0);
    }
  }
}

function increment(counts: Map<string, CountedText>, key: string, sourceOffset: number): void {
  const current = counts.get(key);
  counts.set(key, {
    count: (current?.count ?? 0) + 1,
    sourceOffset: current?.sourceOffset ?? sourceOffset,
  });
}

function rankedRepeatedText(
  counts: ReadonlyMap<string, CountedText>,
  kind: ScreenplayRepeatedTextStatistic['kind'],
  limit: number,
): ScreenplayRepeatedTextStatistic[] {
  return [...counts.entries()]
    .filter(([, value]) => value.count >= 2)
    .map(([text, value]) => ({
      id: `${kind}-${text}`,
      text,
      count: value.count,
      kind,
      sourceOffset: value.sourceOffset,
    }))
    .sort((first, second) => second.count - first.count || first.text.localeCompare(second.text))
    .slice(0, limit);
}
