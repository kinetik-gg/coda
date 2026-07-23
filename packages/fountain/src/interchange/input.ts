import { ScreenplayInterchangeError } from './types';

export type ScreenplayInput = string | Uint8Array;

function assertWellFormedUnicode(source: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      throw invalidEncoding();
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw invalidEncoding();
  }
}

function invalidEncoding(cause?: unknown): ScreenplayInterchangeError {
  return new ScreenplayInterchangeError(
    'INVALID_ENCODING',
    'The screenplay text encoding is invalid.',
    cause === undefined ? {} : { cause },
  );
}

export function decodeScreenplayInput(input: ScreenplayInput): string {
  if (typeof input === 'string') {
    assertWellFormedUnicode(input);
    return input;
  }
  if (input.byteLength === 0) return '';

  try {
    if (input[0] === 0xff && input[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(input.subarray(2));
    }
    if (input[0] === 0xfe && input[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(input.subarray(2));
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } catch (error) {
    throw invalidEncoding(error);
  }
}

export function requireNonEmptySource(input: ScreenplayInput): string {
  const source = decodeScreenplayInput(input);
  if (source.trim() === '') {
    throw new ScreenplayInterchangeError('EMPTY_INPUT', 'The screenplay file is empty.');
  }
  return source;
}

export function requireNonEmptyUtf8Source(input: ScreenplayInput): string {
  if (typeof input === 'string') return requireNonEmptySource(input);
  if ((input[0] === 0xff && input[1] === 0xfe) || (input[0] === 0xfe && input[1] === 0xff)) {
    throw invalidEncoding();
  }
  try {
    return requireNonEmptySource(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input),
    );
  } catch (error) {
    if (error instanceof ScreenplayInterchangeError) throw error;
    throw invalidEncoding(error);
  }
}
