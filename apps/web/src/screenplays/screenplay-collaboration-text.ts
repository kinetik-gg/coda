import type * as Y from 'yjs';

export const SCREENPLAY_COLLAB_TEXT_KEY = 'source';

/** Bridges Y.Text's runtime string override, which its declarations expose as Object.toString. */
export function screenplayCollaborationText(text: Y.Text): string {
  return (text as Y.Text & { toString(): string }).toString();
}
