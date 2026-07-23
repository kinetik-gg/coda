import { decodeScreenplayInput, type ScreenplayInput } from './input';
import type { ScreenplayFormatDetection, ScreenplayInterchangeFormat } from './types';

const EXTENSION_FORMATS: Readonly<Record<string, ScreenplayInterchangeFormat>> = {
  '.celtx': 'celtx',
  '.fadein': 'fade-in',
  '.fdx': 'final-draft',
  '.fountain': 'fountain',
  '.spmd': 'fountain',
  '.highland': 'highland',
  '.mmsw': 'movie-magic',
  '.scw': 'movie-magic',
  '.txt': 'plain-text',
};

const FOUNTAIN_STRUCTURE = [
  /^(?:Title|Credit|Author|Authors|Source|Draft date|Contact):\s*\S/im,
  /^(?:INT\.?|EXT\.?|INT\.\/EXT\.?|INT\/EXT\.?|I\/E\.?|EST\.?)\s/m,
  /^\.[\p{L}\p{N}].*$/mu,
  /^@?\p{Lu}[\p{Lu}\p{N} ._'()#-]*\^?\r?\n\S/mu,
  /^(?:#{1,6}|=|>|~|!|\[\[|\/\*)/m,
] as const;

export function detectScreenplayFormat(
  input: ScreenplayInput,
  filename?: string,
): ScreenplayFormatDetection {
  const source = decodeScreenplayInput(input).replace(/^\uFEFF/u, '');
  const extension = filename ? extensionOf(filename) : undefined;
  const extensionFormat = extension ? EXTENSION_FORMATS[extension] : undefined;

  if (hasFinalDraftRoot(source)) {
    return { format: 'final-draft', confidence: 'certain', reason: 'FinalDraft XML root element' };
  }
  if (extensionFormat && extensionFormat !== 'plain-text') {
    return {
      format: extensionFormat,
      confidence: 'certain',
      reason: `${extension} filename extension`,
    };
  }
  if (FOUNTAIN_STRUCTURE.some((pattern) => pattern.test(source))) {
    return { format: 'fountain', confidence: 'probable', reason: 'Recognized Fountain structure' };
  }
  if (extensionFormat === 'plain-text') {
    return { format: 'plain-text', confidence: 'certain', reason: '.txt filename extension' };
  }
  return { format: 'plain-text', confidence: 'fallback', reason: 'No screenplay syntax detected' };
}

function extensionOf(filename: string): string | undefined {
  const normalized = filename.trim().toLowerCase();
  const separator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const basename = normalized.slice(separator + 1);
  const dot = basename.lastIndexOf('.');
  return dot >= 0 && dot < basename.length - 1 ? basename.slice(dot) : undefined;
}

function hasFinalDraftRoot(source: string): boolean {
  let cursor = skipWhitespace(source, 0);
  if (startsWithIgnoreCase(source, cursor, '<?xml') && xmlNameBoundary(source[cursor + 5])) {
    const declarationEnd = source.indexOf('?>', cursor + 5);
    if (declarationEnd < 0) return false;
    cursor = skipWhitespace(source, declarationEnd + 2);
  }
  while (source.startsWith('<!--', cursor)) {
    const commentEnd = source.indexOf('-->', cursor + 4);
    if (commentEnd < 0) return false;
    cursor = skipWhitespace(source, commentEnd + 3);
  }
  const root = '<FinalDraft';
  if (!startsWithIgnoreCase(source, cursor, root)) return false;
  const boundary = source[cursor + root.length];
  return ['>', '/', undefined].includes(boundary) || isWhitespace(boundary);
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && character.trim() === '';
}

function startsWithIgnoreCase(source: string, start: number, expected: string): boolean {
  return source.slice(start, start + expected.length).toLowerCase() === expected.toLowerCase();
}

function xmlNameBoundary(character: string | undefined): boolean {
  return character === undefined || !/[A-Za-z0-9_.:-]/u.test(character);
}
