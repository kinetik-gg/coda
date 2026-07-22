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

  if (/^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<FinalDraft\b/iu.test(source)) {
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
  const match = /(?:^|[\\/])?[^\\/]*(\.[^.\\/]+)$/u.exec(filename.trim().toLowerCase());
  return match?.[1];
}
