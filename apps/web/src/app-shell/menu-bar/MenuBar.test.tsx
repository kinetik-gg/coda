// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuBar, type MenuBarModel } from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'userAgentData');
});

interface TestContext {
  canSave: boolean;
  saved: boolean;
  showTools: boolean;
  onSave: () => void;
  onZen: () => void;
}

function model(): MenuBarModel<TestContext> {
  return {
    ariaLabel: 'Test menu',
    menus: [
      {
        id: 'file',
        label: 'File',
        items: () => [
          {
            kind: 'action',
            id: 'save',
            label: 'Save',
            keybinding: 'save',
            enabled: (c) => c.canSave,
            run: (c) => c.onSave(),
          },
          {
            kind: 'action',
            id: 'saved',
            label: 'Saved',
            checked: (c) => c.saved,
            run: () => {},
          },
          { kind: 'separator', id: 'sep' },
          {
            kind: 'custom',
            id: 'hint',
            render: () => <span role="presentation">Autosave on</span>,
          },
        ],
      },
      {
        id: 'view',
        label: 'View',
        items: () => [
          {
            kind: 'action',
            id: 'zen',
            label: 'Zen Mode',
            keybinding: 'zenMode',
            run: (c) => c.onZen(),
          },
          {
            kind: 'submenu',
            id: 'more',
            label: 'More',
            items: () => [
              {
                kind: 'action',
                id: 'full',
                label: 'Full Screen',
                keybinding: 'toggleFullscreen',
                run: () => {},
              },
            ],
          },
        ],
      },
      {
        id: 'tools',
        label: 'Tools',
        visible: (c) => c.showTools,
        items: () => [{ kind: 'action', id: 'noop', label: 'No-op', run: () => {} }],
      },
    ],
  };
}

function renderBar(overrides: Partial<TestContext> = {}) {
  const ctx: TestContext = {
    canSave: true,
    saved: false,
    showTools: true,
    onSave: vi.fn(),
    onZen: vi.fn(),
    ...overrides,
  };
  render(<MenuBar model={model()} context={ctx} />);
  return ctx;
}

describe('MenuBar framework', () => {
  it('runs actions and resolves shortcut labels through the keybindings layer', () => {
    const ctx = renderBar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    const save = screen.getByRole('menuitem', { name: /^Save/ });
    expect(within(save).getByText('Ctrl + S')).toBeInTheDocument();
    fireEvent.click(save);
    expect(ctx.onSave).toHaveBeenCalledOnce();
  });

  it('disables items whose enablement predicate is false and skips them in nav', () => {
    const ctx = renderBar({ canSave: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    const save = screen.getByRole('menuitem', { name: /^Save/ });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(ctx.onSave).not.toHaveBeenCalled();
  });

  it('renders checkbox state and custom presentation rows', () => {
    renderBar({ saved: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Saved' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('Autosave on')).toBeInTheDocument();
  });

  it('hides menus whose visibility predicate is false', () => {
    renderBar({ showTools: false });
    expect(screen.queryByRole('menuitem', { name: 'Tools' })).not.toBeInTheDocument();
  });

  it('opens a submenu by keyboard and closes it back to its trigger', async () => {
    renderBar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    const trigger = screen.getByRole('menuitem', { name: /More/ });
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const submenu = await screen.findByRole('menu', { name: 'More' });
    await waitFor(() =>
      expect(within(submenu).getByRole('menuitem', { name: /Full Screen/ })).toHaveFocus(),
    );
    fireEvent.keyDown(submenu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument();
  });

  it('renders platform-specific shortcut labels including modifier-less chords', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { platform: 'macOS' },
    });
    renderBar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(
      within(screen.getByRole('menuitem', { name: /Zen Mode/ })).getByText('⌘⇧Enter'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /More/ }));
    expect(screen.getByText('F11')).toBeInTheDocument();
  });
});
