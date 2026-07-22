// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenplayZenControls } from './ScreenplayZenControls';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ScreenplayZenControls', () => {
  it('shows writing controls and fades until the pointer returns nearby', () => {
    vi.useFakeTimers();
    const onTypewriterChange = vi.fn();
    const onFocusChange = vi.fn();
    render(
      <ScreenplayZenControls
        typewriterScrolling={false}
        focusMode={false}
        focusScope="paragraph"
        onTypewriterChange={onTypewriterChange}
        onFocusChange={onFocusChange}
        onExit={() => undefined}
      />,
    );

    const controls = screen.getByRole('toolbar', { name: 'Zen writing controls' }).parentElement!;
    expect(controls).toHaveAttribute('data-dimmed', 'false');
    expect(screen.getByLabelText('Zen mode shortcuts')).toHaveTextContent('Cycle focus');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(controls).toHaveAttribute('data-dimmed', 'true');
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    expect(controls).toHaveAttribute('data-dimmed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Typewriter Scrolling' }));
    expect(onTypewriterChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Line Focus' }));
    expect(onFocusChange).toHaveBeenCalledWith('line');
  });
});
