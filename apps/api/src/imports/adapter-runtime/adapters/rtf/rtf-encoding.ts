/**
 * Byte-to-character decoding for RTF literal text.
 *
 * RTF predates Unicode: literal bytes and `\'hh` escapes are code-page bytes,
 * and the code page is announced by the document (`\ansicpg1252`) or implied by
 * a character-set keyword (`\ansi`, `\mac`, `\pc`, `\pca`). Unicode arrives
 * separately through `\uN`, with a code-page approximation immediately after it
 * that a Unicode-aware reader must skip.
 *
 * Only Windows-1252 is decoded exactly. That is the code page essentially every
 * word processor writes for Latin-script documents, and it is a strict superset
 * of ASCII, so an unknown code page decoded as Windows-1252 still recovers all
 * ASCII text — which for a screenplay is the overwhelming majority of the
 * content. Anything else is decoded as Windows-1252 *and* reported through a
 * document warning, so a reader is told the accented characters may be wrong
 * rather than being silently handed plausible-looking mojibake. Adding real
 * tables for further code pages is a contained change: only
 * {@link isExactlyDecodableCodePage} and {@link decodeCodePageByte} need to know.
 */

/** Windows-1252, the only code page decoded exactly. */
export const RTF_DEFAULT_CODE_PAGE = 1252;

/** Replacement used for a byte with no assignment in Windows-1252. */
const REPLACEMENT = '�';

/**
 * Windows-1252's 0x80-0x9F block, the only range where it differs from
 * ISO-8859-1. Every other byte maps to the code point of the same value.
 */
const CP1252_HIGH = [
  '€',
  REPLACEMENT,
  '‚',
  'ƒ',
  '„',
  '…',
  '†',
  '‡',
  'ˆ',
  '‰',
  'Š',
  '‹',
  'Œ',
  REPLACEMENT,
  'Ž',
  REPLACEMENT,
  REPLACEMENT,
  '‘',
  '’',
  '“',
  '”',
  '•',
  '–',
  '—',
  '˜',
  '™',
  'š',
  '›',
  'œ',
  REPLACEMENT,
  'ž',
  'Ÿ',
] as const;

/** Character-set keywords that select a code page without `\ansicpg`. */
const CHARSET_KEYWORD_CODE_PAGES: ReadonlyMap<string, number> = new Map([
  ['ansi', 1252],
  ['mac', 10_000],
  ['pc', 437],
  ['pca', 850],
]);

/** The code page implied by a `\ansi`/`\mac`/`\pc`/`\pca` keyword, if any. */
export function codePageForCharsetKeyword(word: string): number | undefined {
  return CHARSET_KEYWORD_CODE_PAGES.get(word);
}

/** Whether {@link decodeCodePageByte} is exact rather than a Windows-1252 approximation. */
export function isExactlyDecodableCodePage(codePage: number): boolean {
  return codePage === RTF_DEFAULT_CODE_PAGE;
}

/** Decodes one code-page byte. Bytes outside 0-255 are treated as unassigned. */
export function decodeCodePageByte(byte: number): string {
  if (byte < 0 || byte > 0xff) return REPLACEMENT;
  if (byte >= 0x80 && byte <= 0x9f) return CP1252_HIGH[byte - 0x80]!;
  return String.fromCharCode(byte);
}

/** Decodes a run of literal bytes with {@link decodeCodePageByte} semantics. */
export function decodeCodePageRun(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let index = start; index < end; index += 1) text += decodeCodePageByte(bytes[index]!);
  return text;
}

/**
 * Turns a `\uN` parameter into a string. RTF writes the parameter as a signed
 * 16-bit value, so anything negative is the unsigned value wrapped; values above
 * the Unicode maximum, and lone surrogates, are hostile or corrupt input and
 * become the replacement character rather than throwing.
 */
export function decodeRtfUnicodeParameter(param: number): { text: string; outOfRange: boolean } {
  const codePoint = param < 0 ? param + 0x1_00_00 : param;
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10_ff_ff) {
    return { text: REPLACEMENT, outOfRange: true };
  }
  if (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff) {
    return { text: REPLACEMENT, outOfRange: true };
  }
  return { text: String.fromCodePoint(codePoint), outOfRange: false };
}
