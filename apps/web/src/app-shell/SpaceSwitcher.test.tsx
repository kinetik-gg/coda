// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpaceSummary } from '../api';
import { handleRailRovingKeyDown } from './rail-keyboard';
import { SpaceSwitcher } from './SpaceSwitcher';

const SPACES: readonly SpaceSummary[] = [
  {
    id: 'first',
    name: 'First Space',
    currentMembership: null,
    resourceCounts: { breakdown: 0, screenplay: 0 },
  },
  {
    id: 'second',
    name: 'Second Space',
    currentMembership: null,
    resourceCounts: { breakdown: 1, screenplay: 2 },
  },
];

function renderSwitcher() {
  const onSelectSpace = vi.fn();
  const onNavigate = vi.fn();
  render(
    <nav aria-label="Coda pages" onKeyDown={handleRailRovingKeyDown}>
      <SpaceSwitcher
        activeSpace={SPACES[0]}
        spaces={SPACES}
        onSelectSpace={onSelectSpace}
        onNavigate={onNavigate}
      />
    </nav>,
  );
  return { onSelectSpace, onNavigate };
}

afterEach(cleanup);

describe('SpaceSwitcher', () => {
  it('opens the Space list, saves a chosen scope through its callback, and opens management', () => {
    const { onNavigate, onSelectSpace } = renderSwitcher();
    const navigation = screen.getByRole('navigation', { name: 'Coda pages' });
    const switcher = within(navigation).getByRole('button', { name: 'First Space' });

    fireEvent.click(switcher);
    fireEvent.click(screen.getByRole('option', { name: 'Second Space' }));
    expect(onSelectSpace).toHaveBeenCalledWith('second');
    expect(screen.queryByRole('listbox', { name: 'Spaces' })).not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole('button', { name: 'Manage First Space Space' }));
    expect(onNavigate).toHaveBeenCalledWith('/spaces/first/manage');
  });

  it('keeps the switcher controls in the rail roving-focus order', () => {
    renderSwitcher();
    const navigation = screen.getByRole('navigation', { name: 'Coda pages' });
    const [switcher, settings] = within(navigation).getAllByRole('button');
    switcher?.focus();
    fireEvent.keyDown(navigation, { key: 'ArrowDown' });
    expect(settings).toHaveFocus();
    fireEvent.keyDown(navigation, { key: 'ArrowUp' });
    expect(switcher).toHaveFocus();
  });
});
