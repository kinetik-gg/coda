// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import { dashboardCommands, type DashboardCommandContext } from './dashboard-commands';
import type { LibraryTarget } from './library-target';

function libraryTarget(overrides: Partial<LibraryTarget> = {}): LibraryTarget {
  return {
    noun: 'screenplays',
    singular: 'screenplay',
    objects: [
      { id: 'a', title: 'Nightfall', subtitle: 'nightfall.fountain' },
      { id: 'b', title: 'Salt Flats', subtitle: 'salt-flats.fountain' },
    ],
    createItem: vi.fn(),
    importItem: vi.fn(),
    focusSearch: vi.fn(),
    refresh: vi.fn(),
    openObject: vi.fn(),
    renameObject: vi.fn(),
    exportObject: vi.fn(),
    trashObject: vi.fn(),
    ...overrides,
  };
}

function context(
  overrides: Partial<Omit<DashboardCommandContext, 'surface'>> = {},
): DashboardCommandContext {
  return {
    surface: 'dashboard',
    route: '/',
    theme: 'coda-dark',
    isFullscreen: false,
    railCollapsed: false,
    isAdministrator: true,
    updateAvailable: false,
    library: libraryTarget(),
    navigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleRail: vi.fn(),
    logout: vi.fn(),
    openExternal: vi.fn(),
    openCredits: vi.fn(),
    openPalette: vi.fn(),
    runLibrary: vi.fn(),
    ...overrides,
  };
}

function openPalette(overrides: Partial<Omit<DashboardCommandContext, 'surface'>> = {}) {
  const ctx = context(overrides);
  const onClose = vi.fn();
  render(
    <CommandPalette
      mode="all"
      commands={dashboardCommands}
      context={ctx}
      library={ctx.library}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole('combobox');
  return { ctx, onClose, input };
}

function activeOption(input: HTMLElement): HTMLElement {
  const id = input.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();
  return document.getElementById(id!)!;
}

// jsdom implements no layout, so the keep-the-highlight-visible call has nothing to call into.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('command palette', () => {
  it('is a labelled modal combobox over a grouped listbox', () => {
    const { input } = openPalette();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveFocus();

    const listbox = screen.getByRole('listbox', { name: 'Command palette results' });
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(within(listbox).getByRole('group', { name: 'File' })).toBeInTheDocument();
    expect(within(listbox).getByRole('group', { name: 'Screenplays' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /New Screenplay/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('filters as the query narrows and reports the count to a live region', () => {
    const { input } = openPalette();
    fireEvent.change(input, { target: { value: 'nightfall' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Nightfall');
    expect(screen.getByText('1 result')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'no-such-command' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matching commands.')).toBeInTheDocument();
    expect(screen.getByText('0 results')).toBeInTheDocument();
  });

  it('moves the highlight with the arrow keys and runs the active row on Enter', () => {
    const { ctx, onClose, input } = openPalette();
    fireEvent.change(input, { target: { value: 'screenplay' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeOption(input)).toHaveTextContent('New Screenplay');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ctx.runLibrary).toHaveBeenCalledWith('createItem');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('jumps to the ends of the list with Home and End', () => {
    const { input } = openPalette();
    fireEvent.keyDown(input, { key: 'End' });
    expect(activeOption(input)).toHaveTextContent('Salt Flats');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(activeOption(input)).toHaveTextContent('New Screenplay');
  });

  it('never highlights or runs a disabled command', () => {
    const { ctx, input } = openPalette({ library: libraryTarget({ objects: [] }) });
    fireEvent.change(input, { target: { value: 'rename' } });
    const option = screen.getByRole('option', { name: /Rename/u });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.pointerDown(option);
    expect(ctx.openPalette).not.toHaveBeenCalled();
  });

  it('closes on Escape, on a backdrop click, and restores focus to the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const ctx = context();
    const onClose = vi.fn();
    const view = render(
      <CommandPalette
        mode="all"
        commands={dashboardCommands}
        context={ctx}
        library={ctx.library}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps Tab inside the single-input dialog', () => {
    const { input } = openPalette();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('acts as an object chooser when a menu command needs a target', () => {
    const ctx = context();
    const onClose = vi.fn();
    render(
      <CommandPalette
        mode="trash"
        commands={dashboardCommands}
        context={ctx}
        library={ctx.library}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Move a screenplay to trash' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Search screenplays…');

    fireEvent.pointerDown(screen.getByRole('option', { name: /Salt Flats/u }));
    expect(ctx.library?.trashObject).toHaveBeenCalledWith('b');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('highlights the row under the pointer', () => {
    const { input } = openPalette();
    const option = screen.getByRole('option', { name: /Sign Out/u });
    fireEvent.pointerMove(option);
    expect(activeOption(input)).toHaveTextContent('Sign Out');
  });
});

describe('command palette trigger', () => {
  it('gives non-keyboard users a labelled way in', () => {
    const onOpen = vi.fn();
    render(<CommandPaletteTrigger onOpen={onOpen} />);
    const trigger = screen.getByRole('button', { name: 'Open the command palette' });
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
