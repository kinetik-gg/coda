/**
 * Scroll-intent arbiter — the single coordinator for editor⇄preview scroll and
 * selection synchronisation.
 *
 * ## Why this exists
 *
 * The editor viewport and the preview scroll position mirror one another, and a
 * preview selection is pushed back into the editor. Every *programmatic* scroll
 * or selection therefore produces an "echo" event on the opposite surface:
 *
 *   - moving the editor caret             → editor viewport change → preview scroll
 *   - scrolling the preview (scroll-sync) → editor reveal          → editor viewport echo
 *   - selecting text in the preview       → editor selection+scroll → editor viewport echo
 *                                                                    → preview offset echo
 *
 * Left unmanaged those echoes ping-pong forever. Historically two independent
 * boolean refs (`previewDrivenScroll`, `previewSelectionInProgress`) each latched
 * "suppress the next echo". Two one-shot latches had three failure modes:
 *
 *   1. an armed latch whose echo never fired stayed armed and later swallowed a
 *      *genuine* user scroll — the "scrolling is intermittently unreliable" bug;
 *   2. the two booleans could disagree, leaving the loop half-suppressed;
 *   3. nothing recorded which interaction currently owned the sync.
 *
 * ## Rules
 *
 * 1. Sync echoes travel on named CHANNELS: `editor-viewport` (editor→preview) and
 *    `preview-offset` (the preview's own scroll report). An INTENT declares which
 *    channels its echoes will arrive on and arms exactly those.
 * 2. `declare(intent)` arms every channel for that intent atomically, so the loop
 *    can never be left half-suppressed (fixes failure mode 2).
 * 3. `shouldSuppress(channel)` is consumed once per echo: the first echo on an
 *    armed channel is suppressed and the channel disarms. This preserves the
 *    original one-echo-per-intent behaviour for the common case.
 * 4. Every armed channel also carries a wall-clock deadline. An echo that never
 *    arrives cannot wedge the loop — once the deadline passes the channel is
 *    treated as disarmed and the next genuine user event propagates (fixes
 *    failure modes 1 and 3).
 * 5. `reset()` is the ground state; a real user gesture (pointer, wheel, key)
 *    clears all pending suppression so user intent always wins.
 */

/** The two directions a synchronisation echo can travel. */
export type ScrollSyncChannel = 'editor-viewport' | 'preview-offset';

/** A programmatic interaction that will produce echoes on one or more channels. */
export type ScrollSyncIntent = 'preview-scroll' | 'preview-selection';

const INTENT_CHANNELS: Record<ScrollSyncIntent, readonly ScrollSyncChannel[]> = {
  // A preview scroll reveals the matching line in the editor: one editor echo.
  'preview-scroll': ['editor-viewport'],
  // A preview selection pushes a selection + scroll into the editor (editor echo)
  // and the same pointer gesture also reports a scroll offset (preview echo).
  'preview-selection': ['editor-viewport', 'preview-offset'],
};

/**
 * How long an armed channel waits for its echo before it is treated as a missed
 * echo. Comfortably longer than a scroll + measure cycle (including smooth-scroll
 * settling) yet far shorter than a deliberate follow-up user gesture, so a real
 * scroll a few hundred milliseconds later is never swallowed.
 */
export const SCROLL_INTENT_WINDOW_MS = 400;

export class ScrollIntentArbiter {
  private readonly deadlines = new Map<ScrollSyncChannel, number>();

  constructor(
    private readonly windowMs: number = SCROLL_INTENT_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Arms suppression for every channel the intent's echoes will arrive on. */
  declare(intent: ScrollSyncIntent): void {
    const deadline = this.now() + this.windowMs;
    for (const channel of INTENT_CHANNELS[intent]) this.deadlines.set(channel, deadline);
  }

  /**
   * True when the current echo on `channel` should be suppressed. Consumes the
   * arming so only the first echo is suppressed; an expired arming disarms and
   * returns false so the echo is treated as genuine user intent.
   */
  shouldSuppress(channel: ScrollSyncChannel): boolean {
    const deadline = this.deadlines.get(channel);
    if (deadline === undefined) return false;
    this.deadlines.delete(channel);
    return this.now() <= deadline;
  }

  /** Clears all pending suppression — a real user gesture always wins. */
  reset(): void {
    this.deadlines.clear();
  }
}

/** Geometry of a target line block, in the scroller's document coordinate space. */
export interface RevealScrollGeometry {
  /** Document-space top of the target line block (CodeMirror `lineBlockAt().top`). */
  blockTop: number;
  /** Height of the target line block, in pixels. */
  blockHeight: number;
  /** Current `scrollDOM.scrollTop`. */
  scrollTop: number;
  /** Visible height of the scroller (`scrollDOM.clientHeight`). */
  viewportHeight: number;
}

/** Floor for the reveal margin — the historical fixed offset, now only a minimum. */
export const MIN_REVEAL_MARGIN = 40;

/**
 * Computes the `scrollTop` that brings a target line block into a comfortable
 * reading band, or `null` when the block is already inside that band so a reveal
 * never forces a redundant jump.
 *
 * The margin is derived from the block's own height (≈ two lines) rather than a
 * fixed 40px offset, so large font sizes and typewriter zoom keep context above
 * the target instead of pinning it to the very top edge or clipping it — the
 * root cause of the `scrollTop = lineBlockAt(offset).top - 40` misbehaviour.
 */
export function revealScrollTop(geometry: RevealScrollGeometry): number | null {
  const { blockTop, blockHeight, scrollTop, viewportHeight } = geometry;
  const blockBottom = blockTop + blockHeight;
  const margin = Math.min(
    Math.max(viewportHeight / 2 - blockHeight, 0),
    Math.max(blockHeight * 2, MIN_REVEAL_MARGIN),
  );
  const visibleTop = scrollTop + margin;
  const visibleBottom = scrollTop + viewportHeight - margin;
  if (blockTop >= visibleTop && blockBottom <= visibleBottom) return null;
  return Math.max(0, blockTop - margin);
}
