// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <nav aria-label="Coda pages" onKeyDown={handleRailRovingKeyDown}>
        <SpaceSwitcher
          activeSpace={SPACES[0]}
          spaces={SPACES}
          onSelectSpace={onSelectSpace}
          onNavigate={onNavigate}
        />
        <button type="button" data-rail-item>
          Screenplays
        </button>
      </nav>
    </QueryClientProvider>,
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Second Space' }));
    expect(onSelectSpace).toHaveBeenCalledWith('second');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole('button', { name: 'Manage First Space Space' }));
    expect(onNavigate).toHaveBeenCalledWith('/spaces/first/manage');
  });

  it('marks the active Space and offers Create Space in the same menu', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'First Space' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'First Space' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Second Space' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Create Space' })).toBeInTheDocument();
  });

  // #338: the list used to render inline in the rail, so opening it pushed the Library group down
  // the sidebar and it sprang back on close. The popup is portalled out of the rail now, so the
  // rail's own subtree — and therefore everything laid out beneath the switcher — is untouched.
  it('overlays the rail instead of reflowing the content beneath it', () => {
    renderSwitcher();
    const navigation = screen.getByRole('navigation', { name: 'Coda pages' });
    const railMarkupWhileClosed = navigation.innerHTML;

    fireEvent.click(screen.getByRole('button', { name: 'First Space' }));

    const menu = screen.getByRole('menu');
    expect(navigation.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    // Only the trigger's own aria-expanded may differ; no element joins or leaves the rail.
    expect(navigation.innerHTML.replaceAll('aria-expanded="true"', 'aria-expanded="false"')).toBe(
      railMarkupWhileClosed,
    );
  });

  it('closes on Escape and returns focus to the trigger, like the panel dropdowns', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'First Space' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when a pointer lands outside the menu', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'First Space' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
