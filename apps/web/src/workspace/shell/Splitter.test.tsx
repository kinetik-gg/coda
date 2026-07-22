// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Splitter } from './Splitter';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn().mockReturnValue(true) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSplitter(axis: 'horizontal' | 'vertical' = 'horizontal', ratio = 5000) {
  const containerRef = createRef<HTMLDivElement>();
  const onCommit = vi.fn();
  const result = render(
    <div ref={containerRef}>
      <Splitter
        axis={axis}
        ratioBasisPoints={ratio}
        containerRef={containerRef}
        onCommit={onCommit}
      />
    </div>,
  );
  vi.spyOn(containerRef.current!, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1002,
    bottom: 502,
    width: 1002,
    height: 502,
    toJSON: () => ({}),
  });
  return { ...result, container: containerRef.current!, onCommit };
}

describe('Splitter', () => {
  it.each([
    ['Home', 500],
    ['End', 9500],
    ['Enter', 5000],
    ['ArrowLeft', 4750],
    ['ArrowRight', 5250],
  ])('commits horizontal %s keyboard resizing', (key, expected) => {
    const { onCommit } = renderSplitter('horizontal', 5000);
    fireEvent.keyDown(screen.getByRole('separator'), { key });
    if (key === 'Enter') expect(onCommit).not.toHaveBeenCalled();
    else expect(onCommit).toHaveBeenCalledWith(expected);
  });

  it('uses vertical arrow semantics and ignores unrelated keys', () => {
    const { onCommit } = renderSplitter('vertical', 5000);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onCommit.mock.calls).toEqual([[4750], [5250]]);
  });

  it('previews and commits a clamped pointer drag', () => {
    const { container, onCommit } = renderSplitter();
    const separator = screen.getByRole('separator');
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 500, clientY: 0 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 10_000, clientY: 0 });
    expect(container.style.gridTemplateColumns).toContain('9500fr');
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 10_000, clientY: 0 });
    expect(onCommit).toHaveBeenCalledWith(9500);
  });

  it('restores the controlled ratio when a pointer drag is cancelled', () => {
    const { container, onCommit } = renderSplitter('vertical', 4000);
    const separator = screen.getByRole('separator');
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 300 });
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    expect(container.style.gridTemplateRows).toContain('4000fr');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
