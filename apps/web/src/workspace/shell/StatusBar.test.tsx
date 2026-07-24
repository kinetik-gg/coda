// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SaveStateChip } from './SaveStateChip';
import { SAVE_STATES, SAVE_STATE_DESCRIPTORS } from './save-state';
import { StatusBar, StatusBarSegment } from './StatusBar';

afterEach(cleanup);

describe('StatusBar', () => {
  it('composes left, center, and right segments into a single row', () => {
    render(
      <StatusBar
        left={<StatusBarSegment>IDENTITY</StatusBarSegment>}
        center={<StatusBarSegment>CENTER INFO</StatusBarSegment>}
        right={<StatusBarSegment>TRAILING</StatusBarSegment>}
      />,
    );
    expect(screen.getByText('IDENTITY')).toBeTruthy();
    expect(screen.getByText('CENTER INFO')).toBeTruthy();
    expect(screen.getByText('TRAILING')).toBeTruthy();
  });

  it('renders only the slots it is given, without stray content from unused slots', () => {
    const { container } = render(
      <StatusBar left={<StatusBarSegment>ONLY LEFT</StatusBarSegment>} />,
    );
    expect(container.textContent).toBe('ONLY LEFT');
  });

  it('surfaces an icon, a title tooltip, and an accent tone on a segment', () => {
    render(
      <StatusBarSegment icon={<span data-testid="icon" />} tone="accent" title="a tooltip">
        ACCENT SEGMENT
      </StatusBarSegment>,
    );
    const segment = screen.getByText('ACCENT SEGMENT', { exact: false });
    expect(segment.closest('span')).toHaveAttribute('title', 'a tooltip');
    expect(screen.getByTestId('icon')).toBeTruthy();
  });
});

describe('SaveStateChip', () => {
  it('renders every canonical save state with its label as an accessible status', () => {
    for (const state of SAVE_STATES) {
      const { unmount } = render(<SaveStateChip state={state} />);
      const descriptor = SAVE_STATE_DESCRIPTORS[state];
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent(descriptor.label);
      unmount();
    }
  });

  it('spins an activity icon for the in-progress states', () => {
    for (const state of ['loading', 'updating', 'saving'] as const) {
      const { container, unmount } = render(<SaveStateChip state={state} />);
      expect(container.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });

  it('shows a static check only once the change is actually saved', () => {
    const { container, unmount } = render(<SaveStateChip state="saved" />);
    expect(container.querySelector('svg')).toBeTruthy();
    unmount();
    for (const state of ['unsaved', 'offline', 'conflict', 'failed'] as const) {
      const { container: rest, unmount: unmountRest } = render(<SaveStateChip state={state} />);
      expect(rest.querySelector('svg')).toBeNull();
      unmountRest();
    }
  });
});
