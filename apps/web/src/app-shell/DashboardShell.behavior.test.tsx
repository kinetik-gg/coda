// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeId } from '../themes';
import { DashboardShell, type DashboardShellProps } from './DashboardShell';

// jsdom implements no layout, so the palette's keep-the-highlight-visible call has nothing to
// call into (see CommandPalette.behavior.test.tsx, which stubs the same thing).
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const healthyDoctor = {
  rows: [{ status: 'ok' }, { status: 'warn' }],
};

const instanceManagement = {
  counts: { storageBytes: 4_200_000 },
};

function stubFetch(doctor: unknown = healthyDoctor, management: unknown = instanceManagement) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/instance/doctor') return envelope(doctor);
      if (path === '/api/v1/instance/management') return envelope(management);
      if (path === '/api/v1/screenplays') return envelope([]);
      if (path === '/api/v1/projects') return envelope([]);
      if (path === '/api/v1/projects/trash') return envelope([]);
      return envelope([]);
    }),
  );
}

function baseProps(overrides: Partial<DashboardShellProps> = {}): DashboardShellProps {
  return {
    route: '/',
    isAdministrator: true,
    theme: 'coda-dark' as ThemeId,
    isFullscreen: false,
    displayName: 'Ada Lovelace',
    onNavigate: vi.fn(),
    chooseTheme: vi.fn(),
    toggleFullscreen: vi.fn(),
    logout: vi.fn(),
    onOpenProject: vi.fn(),
    onCreateProject: vi.fn(),
    onOpenScreenplay: vi.fn(),
    ...overrides,
  };
}

function renderShell(props: DashboardShellProps) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardShell {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => stubFetch());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DashboardShell chrome', () => {
  it('mounts the library surfaces inside the content frame', async () => {
    const { rerender } = renderShell(baseProps({ route: '/' }));
    expect(await screen.findByRole('heading', { name: 'Screenplays' })).toBeVisible();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...baseProps({ route: '/trash' })} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Coda pages' })).toBeInTheDocument();
  });

  it('runs File menu actions through the declarative model', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    // The command carries a keybinding, so its accessible name also announces the chord — match
    // the label rather than the full string (see dashboard-commands.ts `new-breakdown`).
    fireEvent.click(screen.getByRole('menuitem', { name: /^New Breakdown/u }));
    expect(props.onNavigate).toHaveBeenCalledWith('/breakdowns/new');

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign Out' }));
    expect(props.logout).toHaveBeenCalledOnce();
  });

  it('collapses the rail from the View menu and expands it from the rail control', () => {
    renderShell(baseProps());
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Hide Sidebar/u }));
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('chooses a theme from the Edit menu submenu', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Light' }));
    expect(props.chooseTheme).toHaveBeenCalledWith('light');
  });

  it('opens Help links without a full-page navigation', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderShell(baseProps());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    expect(open).toHaveBeenCalledWith('https://coda.github.io', '_blank', 'noopener,noreferrer');
  });

  it('navigates and signs out from the user menu', () => {
    const props = baseProps();
    renderShell(props);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Account settings' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account');

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(props.logout).toHaveBeenCalledOnce();
  });

  it('shows the single canonical instance-health signal exactly once, in the status bar', async () => {
    renderShell(baseProps());
    // Issue #165: health used to render twice — a masthead chip and the status-bar segment. There
    // is now exactly one occurrence, and it lives in the status bar rather than the masthead.
    const healthy = await screen.findAllByText('Healthy');
    expect(healthy).toHaveLength(1);
    expect(healthy[0]!.closest('[class*="statusBar"]')).not.toBeNull();

    stubFetch({ rows: [{ status: 'error' }] });
    cleanup();
    renderShell(baseProps());
    expect(await screen.findAllByText('Issues')).toHaveLength(1);
  });

  it('shows the update chip only when an update is available', () => {
    const { rerender } = renderShell(baseProps({ updateAvailable: false }));
    expect(screen.queryByText('Update')).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...baseProps({ updateAvailable: true })} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('reports dashboard state in the status bar — item count, storage, connection — never editor state', async () => {
    renderShell(baseProps({ isAdministrator: true }));
    expect(await screen.findByText('4.2 MB')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(await screen.findByTitle('0 screenplays in this instance')).toBeInTheDocument();
    // Nothing that belongs to a document editor (zoom, word count, save state) leaks in here.
    expect(screen.queryByText(/zoom/iu)).not.toBeInTheDocument();
  });

  it('omits the storage segment for a non-administrator rather than requesting an admin-only endpoint', async () => {
    renderShell(baseProps({ isAdministrator: false }));
    await screen.findAllByText('Healthy');
    expect(screen.queryByText('4.2 MB')).not.toBeInTheDocument();
  });

  it('roves rail focus with the arrow keys', () => {
    renderShell(baseProps());
    const rail = screen.getByRole('navigation', { name: 'Coda pages' });
    const items = within(rail).getAllByRole('button');
    items[0]!.focus();
    fireEvent.keyDown(rail, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  it('reserves a frameless-window drag region and keeps interactive controls out of it', () => {
    const { rerender } = renderShell(baseProps({ windowChrome: 'framed' }));
    expect(document.querySelector('[data-window-chrome]')).toHaveAttribute(
      'data-window-chrome',
      'framed',
    );

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...baseProps({ windowChrome: 'frameless' })} />
      </QueryClientProvider>,
    );
    const shell = document.querySelector('[data-window-chrome]');
    expect(shell).toHaveAttribute('data-window-chrome', 'frameless');
    // The traffic-light inset spacer sits ahead of the brand button in every case; only the width
    // token behind `data-window-chrome` changes (see DashboardShell.module.css).
    const inset = shell!.querySelector('[aria-hidden="true"]');
    expect(inset).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coda' }).compareDocumentPosition(inset!)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it('opens the real command palette from the masthead trigger, with the menu commands inside it', () => {
    renderShell(baseProps());
    fireEvent.click(screen.getByRole('button', { name: 'Open the command palette' }));
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(dialog).getByRole('option', { name: /New Screenplay/u })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a filterable, pinnable working set of screenplays in the rail, and no rail row for Account or Administration (#163)', async () => {
    stubFetch();
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/instance/doctor') return envelope(healthyDoctor);
      if (path === '/api/v1/instance/management') return envelope(instanceManagement);
      if (path === '/api/v1/screenplays') {
        return envelope([
          {
            id: 'a',
            title: 'Nightfall',
            filename: 'nightfall.fountain',
            paperSize: 'letter',
            version: 1,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-07-10T00:00:00.000Z',
          },
          {
            id: 'b',
            title: 'Salt Flats',
            filename: 'salt-flats.fountain',
            paperSize: 'letter',
            version: 1,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ]);
      }
      return envelope([]);
    });
    renderShell(baseProps());

    const rail = screen.getByRole('navigation', { name: 'Coda pages' });
    expect(await within(rail).findByRole('button', { name: 'Nightfall' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Salt Flats' })).toBeInTheDocument();

    // The 17 Account/Administration rows — and their `Settings:` label prefixes — moved to the
    // settings surface; the rail carries only the Library group and the working set now.
    expect(within(rail).queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(rail).queryByText(/Settings:/u)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter screenplays' }), {
      target: { value: 'salt' },
    });
    expect(within(rail).queryByRole('button', { name: 'Nightfall' })).not.toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Salt Flats' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter screenplays' }), {
      target: { value: '' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pin Nightfall' }));
    expect(screen.getByRole('button', { name: 'Unpin Nightfall' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /*
   * #169: the management URL that used to render a page of its own must still resolve, and must
   * open the same object with its modal presented over the library it belongs to.
   */
  it('resolves the screenplay management URL to the library with its share modal presented', async () => {
    const managed = {
      id: 'a0b1-c2d3',
      title: 'Night Bus',
      filename: 'night-bus.fountain',
      ownerUserId: 'owner',
      version: 1,
      roles: [],
      memberships: [],
      invitations: [],
      currentMembership: { id: 'm1', roleId: 'r1', permissions: [] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/instance/doctor') return envelope(healthyDoctor);
        if (path === '/api/v1/instance/management') return envelope(instanceManagement);
        if (path === '/api/v1/screenplays/a0b1-c2d3/management') return envelope(managed);
        return envelope([]);
      }),
    );
    const props = baseProps({ route: '/screenplays/a0b1-c2d3/manage' });
    renderShell(props);

    // The library is still the surface underneath.
    expect(await screen.findByRole('heading', { name: 'Screenplays' })).toBeVisible();
    expect(await screen.findByRole('dialog', { name: 'Night Bus' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onNavigate).toHaveBeenCalledWith('/screenplays');
  });

  it('mounts breakdown settings inside the shell frame, with its share modal on the bare manage URL', async () => {
    const managed = {
      id: 'b0c1-d2e3',
      name: 'The Quiet Signal',
      description: null,
      ownerUserId: 'owner',
      version: 1,
      entityTypes: [],
      roles: [],
      memberships: [],
      currentMembership: { id: 'm1', roleId: 'r1', permissions: [] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/instance/doctor') return envelope(healthyDoctor);
        if (path === '/api/v1/instance/management') return envelope(instanceManagement);
        if (path === '/api/v1/projects/b0c1-d2e3/management') return envelope(managed);
        return envelope([]);
      }),
    );

    const structure = baseProps({ route: '/breakdowns/b0c1-d2e3/manage/structure' });
    const { rerender } = renderShell(structure);
    // Inside the shell frame: the rail and the status bar are present, so the surface obeys the
    // same fixed-viewport geometry as the libraries rather than floating in a document column.
    expect(await screen.findByRole('heading', { name: 'Breakdown settings' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Coda pages' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    const share = baseProps({ route: '/breakdowns/b0c1-d2e3/manage' });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...share} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'The Quiet Signal' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(share.onNavigate).toHaveBeenCalledWith('/breakdowns/b0c1-d2e3/manage/structure');
  });

  it('opens the settings surface from the rail Settings entry and from the identity control', () => {
    const props = baseProps();
    renderShell(props);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account');

    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account');
  });
});
