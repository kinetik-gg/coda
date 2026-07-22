// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('describes focused controls and waits for its exit animation', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Explains this control with useful additional context">
        <button type="button">Action</button>
      </Tooltip>,
    );

    const button = screen.getByRole('button', { name: 'Action' });
    fireEvent.focus(button);
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const tooltip = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.getAttribute('data-state')).toBe('open');

    fireEvent.blur(button);
    expect(tooltip.getAttribute('data-state')).toBe('closing');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('can show explanatory text for disabled controls on hover', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Unavailable until the previous operation has completed">
        <button type="button" disabled>
          Action
        </button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Action' }).parentElement;
    expect(wrapper).not.toBeNull();
    fireEvent.mouseEnter(wrapper!);
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByRole('tooltip').textContent).toBe(
      'Unavailable until the previous operation has completed',
    );
  });
});
