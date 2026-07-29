import * as Y from 'yjs';

export interface EncodedScreenplayCommentAnchor {
  anchorStart: string;
  anchorEnd: string;
  quotedText: string;
}

export interface ResolvedScreenplayCommentAnchor {
  start: number;
  end: number;
  detached: boolean;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodedPosition(text: Y.Text, index: number): string {
  return encode(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index)));
}

export function createScreenplayCommentAnchor(
  text: Y.Text,
  start: number,
  end: number,
): EncodedScreenplayCommentAnchor {
  const lower = Math.max(0, Math.min(start, end, text.length));
  const upper = Math.max(lower, Math.min(Math.max(start, end), text.length));
  if (lower === upper) throw new Error('Select a screenplay range before adding a comment.');
  return {
    anchorStart: encodedPosition(text, lower),
    anchorEnd: encodedPosition(text, upper),
    quotedText: text.toString().slice(lower, upper).slice(0, 512),
  };
}

function absolutePosition(text: Y.Text, encoded: string): number | undefined {
  if (!text.doc) return undefined;
  try {
    const position = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(decode(encoded)),
      text.doc,
    );
    return position?.type === text ? position.index : undefined;
  } catch {
    return undefined;
  }
}

export function resolveScreenplayCommentAnchor(
  text: Y.Text,
  anchorStart: string,
  anchorEnd: string,
): ResolvedScreenplayCommentAnchor {
  const start = absolutePosition(text, anchorStart);
  const end = absolutePosition(text, anchorEnd);
  if (start === undefined || end === undefined) {
    return { start: 0, end: 0, detached: true };
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return { start: lower, end: upper, detached: lower === upper };
}
