import type * as Y from 'yjs';

/**
 * Y.Text overrides `toString` at runtime, but its declarations expose only Object's signature.
 * Bridge that declaration gap once without weakening call sites to `any`.
 */
export function yTextContent(text: Y.Text): string {
  return (text as unknown as { toString(): string }).toString();
}
