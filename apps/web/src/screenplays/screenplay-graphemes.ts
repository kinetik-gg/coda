export interface ScreenplayGrapheme {
  text: string;
  start: number;
  end: number;
}

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function screenplayGraphemes(value: string): ScreenplayGrapheme[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment, index }) => ({
    text: segment,
    start: index,
    end: index + segment.length,
  }));
}

export function screenplayGraphemeCount(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export function chunkScreenplayGraphemes(value: string, size: number): string[] {
  if (size < 1) throw new RangeError('Grapheme chunk size must be positive.');
  const graphemes = screenplayGraphemes(value);
  const chunks: string[] = [];
  for (let index = 0; index < graphemes.length; index += size) {
    const first = graphemes[index];
    const last = graphemes[Math.min(index + size, graphemes.length) - 1];
    if (first && last) chunks.push(value.slice(first.start, last.end));
  }
  return chunks;
}
