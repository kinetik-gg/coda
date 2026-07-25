import { describe, expect, it } from 'vitest';

import {
  MIN_REVEAL_MARGIN,
  revealScrollTop,
  ScrollIntentArbiter,
  SCROLL_INTENT_WINDOW_MS,
} from './screenplay-scroll-intent';

function fakeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe('ScrollIntentArbiter', () => {
  it('suppresses exactly one echo per declared channel', () => {
    const arbiter = new ScrollIntentArbiter();
    arbiter.declare('preview-scroll');
    // First editor-viewport echo is the programmatic one — suppress it.
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(true);
    // A second echo is genuine user scroll — let it propagate.
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(false);
  });

  it('arms both channels for a preview selection atomically', () => {
    const arbiter = new ScrollIntentArbiter();
    arbiter.declare('preview-selection');
    // Order mirrors ScreenplayPreview.reportSelection: offset report then editor echo.
    expect(arbiter.shouldSuppress('preview-offset')).toBe(true);
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(true);
  });

  it('never suppresses a channel that was not armed', () => {
    const arbiter = new ScrollIntentArbiter();
    arbiter.declare('preview-scroll');
    // preview-scroll does not touch preview-offset.
    expect(arbiter.shouldSuppress('preview-offset')).toBe(false);
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(true);
  });

  it('does not wedge when the expected echo never arrives', () => {
    const clock = fakeClock();
    const arbiter = new ScrollIntentArbiter(SCROLL_INTENT_WINDOW_MS, clock.now);
    // A reveal that did not actually scroll leaves the channel armed...
    arbiter.declare('preview-scroll');
    // ...but a genuine user scroll arriving after the window still propagates.
    clock.advance(SCROLL_INTENT_WINDOW_MS + 1);
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(false);
  });

  it('suppresses an echo that arrives within the window', () => {
    const clock = fakeClock();
    const arbiter = new ScrollIntentArbiter(SCROLL_INTENT_WINDOW_MS, clock.now);
    arbiter.declare('preview-scroll');
    clock.advance(SCROLL_INTENT_WINDOW_MS);
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(true);
  });

  it('reset() clears pending suppression so user intent wins', () => {
    const arbiter = new ScrollIntentArbiter();
    arbiter.declare('preview-selection');
    arbiter.reset();
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(false);
    expect(arbiter.shouldSuppress('preview-offset')).toBe(false);
  });

  it('re-declaring refreshes the deadline of an already-armed channel', () => {
    const clock = fakeClock();
    const arbiter = new ScrollIntentArbiter(SCROLL_INTENT_WINDOW_MS, clock.now);
    arbiter.declare('preview-scroll');
    clock.advance(SCROLL_INTENT_WINDOW_MS - 10);
    arbiter.declare('preview-scroll');
    clock.advance(SCROLL_INTENT_WINDOW_MS - 10);
    // Would have expired against the first declare, but the second refreshed it.
    expect(arbiter.shouldSuppress('editor-viewport')).toBe(true);
  });
});

describe('revealScrollTop', () => {
  it('leaves an already comfortably-visible block in place', () => {
    // Block sits in the middle of a tall viewport — no jump.
    const result = revealScrollTop({
      blockTop: 500,
      blockHeight: 20,
      scrollTop: 300,
      viewportHeight: 600,
    });
    expect(result).toBeNull();
  });

  it('scrolls an off-screen block into view with a line-height margin', () => {
    const blockHeight = 20;
    const result = revealScrollTop({
      blockTop: 2000,
      blockHeight,
      scrollTop: 0,
      viewportHeight: 600,
    });
    // Margin is two line heights here, well above the historical 40px floor.
    expect(result).toBe(2000 - blockHeight * 2);
  });

  it('keeps context above the target rather than pinning it to the top edge', () => {
    const result = revealScrollTop({
      blockTop: 1000,
      blockHeight: 30,
      scrollTop: 0,
      viewportHeight: 800,
    });
    expect(result).not.toBeNull();
    // The line lands `margin` below the top, never flush against it.
    expect(result ?? 0).toBeLessThan(1000);
    expect(1000 - (result ?? 0)).toBeGreaterThanOrEqual(MIN_REVEAL_MARGIN);
  });

  it('never returns a negative scrollTop near the top of the document', () => {
    const result = revealScrollTop({
      blockTop: 10,
      blockHeight: 20,
      scrollTop: 400,
      viewportHeight: 600,
    });
    expect(result).toBe(0);
  });

  it('honours the minimum margin when line blocks are very short', () => {
    const result = revealScrollTop({
      blockTop: 5000,
      blockHeight: 8,
      scrollTop: 0,
      viewportHeight: 600,
    });
    // blockHeight * 2 = 16 < floor, so the 40px floor applies.
    expect(result).toBe(5000 - MIN_REVEAL_MARGIN);
  });

  it('caps the margin on short viewports so the band never inverts', () => {
    // Viewport barely taller than the block: margin caps at (h/2 - block).
    const result = revealScrollTop({
      blockTop: 300,
      blockHeight: 40,
      scrollTop: 0,
      viewportHeight: 100,
    });
    const margin = Math.min(Math.max(100 / 2 - 40, 0), Math.max(40 * 2, MIN_REVEAL_MARGIN));
    expect(result).toBe(300 - margin);
  });
});
