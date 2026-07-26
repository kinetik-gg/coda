import type * as Y from 'yjs';

/**
 * Shared constants for the live-collaboration gateway channel (ADR:
 * docs/adr-collaboration-engine-and-transport.md). Kept in one place so the room-naming and
 * document-shape conventions below cannot drift between the log/checkpoint service, the gateway,
 * and the compaction job.
 */

/**
 * `Y.Text` overrides `toString()` at runtime (it returns the text content), but the shipped
 * `yjs` type declarations do not express that override, so TypeScript sees only
 * `Object.prototype.toString`. This is the one place that gap is bridged, instead of an
 * `eslint-disable` at every call site.
 */
export function yTextToString(text: Y.Text): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- see the doc comment above.
  return text.toString();
}

/** Mirrors the existing `project:<id>` room convention (`realtime.gateway.ts`). */
export function screenplayCollabRoom(screenplayId: string): string {
  return `screenplay:${screenplayId}`;
}

/**
 * The single shared `Y.Text` key every Yjs document for a screenplay uses to hold the Fountain
 * source. The CodeMirror binding (#155) MUST bind `doc.getText(SCREENPLAY_COLLAB_TEXT_KEY)` — the
 * compaction job's byte-identity check (Decision 3, step 3) and the first-join bootstrap below both
 * depend on every writer using this exact key.
 */
export const SCREENPLAY_COLLAB_TEXT_KEY = 'source';

/**
 * A synthetic author/client identity used for the one system-authored log row: the bootstrap seed
 * that carries a screenplay's pre-collaboration `sourceText` into its first Yjs document (see
 * `ScreenplayCollabLogService.ensureBootstrapped`). Never produced by a real client.
 */
export const SCREENPLAY_COLLAB_BOOTSTRAP_CLIENT_ID = 'server-bootstrap';
