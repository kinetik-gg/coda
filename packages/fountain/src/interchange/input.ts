import { ScreenplayInterchangeError } from './types';

export type ScreenplayInput = string | Uint8Array;

export function decodeScreenplayInput(input: ScreenplayInput): string {
  if (typeof input === 'string') return input;
  if (input.byteLength === 0) return '';

  try {
    if (input[0] === 0xff && input[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(input.subarray(2));
    }
    if (input[0] === 0xfe && input[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(input.subarray(2));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch (error) {
    throw new ScreenplayInterchangeError('INVALID_ENCODING', 'The screenplay text encoding is invalid.', {
      cause: error,
    });
  }
}

export function requireNonEmptySource(input: ScreenplayInput): string {
  const source = decodeScreenplayInput(input).replace(/^\uFEFF/u, '');
  if (source.trim() === '') {
    throw new ScreenplayInterchangeError('EMPTY_INPUT', 'The screenplay file is empty.');
  }
  return source;
}
