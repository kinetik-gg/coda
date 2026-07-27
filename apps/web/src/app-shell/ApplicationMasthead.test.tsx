// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationMasthead, type ApplicationMastheadContext } from './ApplicationMasthead';
import { HostWindowCapabilitiesProvider } from './host-window-capabilities';

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

const managing = {
  role: { permissions: [{ permission: 'manage_project_settings' }] },
};

function breakdownContext(
  overrides: Partial<
    Omit<Extract<ApplicationMastheadContext, { surface: 'breakdown' }>, 'surface'>
  > = {},
): Extract<ApplicationMastheadContext, { surface: 'breakdown' }> {
  return {
    surface: 'breakdown',
    workspaceId: 'project-1',
    currentProject: {
      id: 'project-1',
      name: 'Feature Film',
      currentMembership: managing,
    },
    projects: [
      { id: 'project-1', name: 'Feature Film' },
      { id: 'project-2', name: 'Documentary' },
    ],
    theme: 'coda-dark',
    isFullscreen: false,
    navigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    logout: vi.fn(),
    openShare: vi.fn(),
    openManage: vi.fn(),
    canManage: true,
    canEditTitle: true,
    onRenameTitle: vi.fn().mockResolvedValue(undefined),
    requestResetWorkspace: vi.fn(),
    requestPublishWorkspace: vi.fn(),
    ...overrides,
  };
}

function setupContext(): Extract<ApplicationMastheadContext, { surface: 'setup' }> {
  return {
    surface: 'setup',
    theme: 'coda-dark',
    isFullscreen: false,
    navigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    logout: vi.fn(),
  };
}

function openMenu(name: string) {
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

describe('context-aware application masthead', () => {
  it('gives the reachable setup route menus, Help, a palette, and preserved navigation', () => {
    const context = setupContext();
    render(<ApplicationMasthead context={context} />);

    expect(screen.queryByRole('button', { name: 'Coda' })).not.toBeInTheDocument();
    // #193 removed the breadcrumb from application chrome. Leaving the surface must survive it,
    // so the Go menu — not a clickable crumb — carries the way back.
    expect(
      screen.queryByRole('navigation', { name: 'Application location' }),
    ).not.toBeInTheDocument();
    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screenplays' }));
    expect(context.navigate).toHaveBeenCalledWith('/');
    expect(screen.getByRole('menuitem', { name: 'Help' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open the command palette' }));
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('option', { name: 'Breakdowns' })).toBeInTheDocument();
  });

  it('keeps setup identity-free while sign-out remains in the File menu', () => {
    render(<ApplicationMasthead context={setupContext()} />);

    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    openMenu('File');
    expect(screen.getByRole('menuitem', { name: 'Sign Out' })).toBeInTheDocument();
  });

  it('keeps the end-aligned project menu inside the application menubar ownership tree', () => {
    const context = breakdownContext();
    render(<ApplicationMasthead context={context} />);

    const menubar = screen.getByRole('menubar', { name: 'Application menu' });
    const project = within(menubar).getByRole('menuitem', { name: 'Feature Film' });
    fireEvent.click(project);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentary' }));
    expect(context.navigate).toHaveBeenCalledWith('/breakdowns/project-2');
  });

  it('projects breakdown commands into both the menus and palette', () => {
    const context = breakdownContext();
    render(<ApplicationMasthead context={context} />);

    openMenu('Workspace');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Workspace…' }));
    expect(context.requestResetWorkspace).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Open the command palette' }));
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('option', { name: /Reset Workspace…/u })).toBeVisible();
    expect(within(palette).getByRole('option', { name: 'Documentary' })).toBeVisible();
  });

  it('opens sharing without navigation and explains permission-gated items', () => {
    const context = breakdownContext();
    const { rerender } = render(<ApplicationMasthead context={context} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(context.openShare).toHaveBeenCalledOnce();
    expect(context.navigate).not.toHaveBeenCalled();

    openMenu('Feature Film');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage breakdown…' }));
    expect(context.openManage).toHaveBeenCalledOnce();
    expect(context.navigate).not.toHaveBeenCalled();

    rerender(
      <ApplicationMasthead context={breakdownContext({ canManage: false, openShare: vi.fn() })} />,
    );
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    openMenu('Feature Film');
    expect(screen.getByRole('menu')).not.toHaveTextContent('Editor User');
    expect(screen.getByRole('menuitem', { name: 'Share…' })).toHaveAttribute(
      'aria-description',
      'You do not have permission to share.',
    );
  });

  it('shares Help links and the generated credits modal across surfaces', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ApplicationMasthead context={breakdownContext()} />);

    openMenu('Help');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    expect(open).toHaveBeenCalledWith(
      'https://kinetik-gg.github.io/coda-docs/',
      '_blank',
      'noopener,noreferrer',
    );

    openMenu('Help');
    const creditsItem = screen.getByRole('menuitem', { name: 'Open Source Credits…' });
    creditsItem.focus();
    fireEvent.click(creditsItem);
    const credits = await screen.findByRole('dialog', { name: 'Open Source Credits' });
    const searchbox = within(credits).getByRole('searchbox', { name: 'Search credits' });
    expect(searchbox).toHaveFocus();
    fireEvent.change(searchbox, { target: { value: 'Coda' } });
    const codaCredit = within(credits).getByText('Coda', { selector: 'strong' }).closest('article');
    if (!codaCredit) throw new Error('Expected the Coda credit row');
    expect(within(codaCredit).getByRole('link', { name: /License text/u })).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:/u),
    );

    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Open Source Credits' })).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Open Source Credits' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('menuitem', { name: 'Help' })).toHaveFocus();
  }, 10_000);

  it('keeps the centred title and palette affordance when the host owns a native menu', () => {
    render(
      <HostWindowCapabilitiesProvider
        capabilities={{
          applicationMenu: 'native',
          windowControls: 'reserved-inset',
          titleBarDrag: 'enabled',
        }}
      >
        <ApplicationMasthead context={breakdownContext()} />
      </HostWindowCapabilitiesProvider>,
    );

    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Rename breakdown' })).toHaveValue('Feature Film');
    expect(screen.getByRole('button', { name: 'Open the command palette' })).toBeVisible();
    expect(document.querySelector('[data-window-controls]')).toHaveAttribute(
      'data-window-controls',
      'reserved-inset',
    );
  });

  it('opens the palette from the shared chord on setup and breakdown surfaces', async () => {
    const { rerender } = render(<ApplicationMasthead context={setupContext()} />);
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    rerender(<ApplicationMasthead context={breakdownContext()} />);
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeVisible(),
    );
  });
});
