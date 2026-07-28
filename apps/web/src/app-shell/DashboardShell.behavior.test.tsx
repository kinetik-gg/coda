// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeId } from '../themes';
import {
  DASHBOARD_SIDEBAR_LAYOUT_CONFIG,
  DashboardShell,
  type DashboardShellProps,
} from './DashboardShell';
import { HostWindowCapabilitiesProvider } from './host-window-capabilities';

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

beforeEach(() => {
  localStorage.clear();
  stubFetch();
});

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

  it('hides the sidebar only from View and restores its persisted keyboard width', () => {
    const first = renderShell(baseProps());
    const separator = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(screen.queryByRole('button', { name: /sidebar/iu })).not.toBeInTheDocument();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(DASHBOARD_SIDEBAR_LAYOUT_CONFIG.default + DASHBOARD_SIDEBAR_LAYOUT_CONFIG.step),
    );
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(DASHBOARD_SIDEBAR_LAYOUT_CONFIG.default),
    );
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', String(DASHBOARD_SIDEBAR_LAYOUT_CONFIG.max));
    fireEvent.keyDown(separator, { key: 'Home' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    const persistedWidth =
      DASHBOARD_SIDEBAR_LAYOUT_CONFIG.min + DASHBOARD_SIDEBAR_LAYOUT_CONFIG.step;
    expect(separator).toHaveAttribute('aria-valuenow', String(persistedWidth));

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Hide Sidebar/u }));
    expect(screen.queryByRole('navigation', { name: 'Coda pages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).not.toBeInTheDocument();
    first.unmount();

    renderShell(baseProps());
    expect(screen.queryByRole('navigation', { name: 'Coda pages' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Show Sidebar/u }));
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute(
      'aria-valuenow',
      String(persistedWidth),
    );
  });

  it('resizes the leading sidebar by pointer against the shell edge', () => {
    renderShell(baseProps());
    const separator = screen.getByRole('separator', { name: 'Resize sidebar' });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
    } as DOMRect);
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 400, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    fireEvent.pointerUp(separator, { pointerId: 1 });
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
    expect(open).toHaveBeenCalledWith(
      'https://kinetik-gg.github.io/coda-docs/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('keeps the dashboard masthead identity-free with account actions in menus', () => {
    const props = baseProps();
    renderShell(props);

    const masthead = screen.getByRole('menubar', { name: 'Application menu' }).closest('header')!;
    expect(
      within(masthead).queryByRole('button', { name: 'Account menu' }),
    ).not.toBeInTheDocument();
    expect(
      within(masthead).getByRole('button', { name: 'Open the command palette' }),
    ).toBeInTheDocument();
    expect(masthead).not.toHaveTextContent('Update');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Preferences…/u }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account/preferences');

    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign Out' }));
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

  it('reports dashboard state in the status bar — item count, storage, connection — never editor state', async () => {
    renderShell(baseProps({ isAdministrator: true }));
    const storageLabel = `${(4.2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
    expect(await screen.findByText(storageLabel)).toBeInTheDocument();
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

  it('resolves host chrome as named capabilities and retains masthead content for native menus', () => {
    renderShell(baseProps());
    expect(document.querySelector('[data-application-menu]')).toHaveAttribute(
      'data-application-menu',
      'in-app',
    );
    expect(screen.getByRole('menubar', { name: 'Application menu' })).toBeInTheDocument();

    cleanup();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <HostWindowCapabilitiesProvider
          capabilities={{
            applicationMenu: 'native',
            windowControls: 'reserved-inset',
            titleBarDrag: 'enabled',
          }}
        >
          <DashboardShell {...baseProps()} />
        </HostWindowCapabilitiesProvider>
      </QueryClientProvider>,
    );
    const host = document.querySelector('[data-application-menu]');
    expect(host).toHaveAttribute('data-application-menu', 'native');
    expect(host).toHaveAttribute('data-window-controls', 'reserved-inset');
    expect(host).toHaveAttribute('data-title-bar-drag', 'enabled');
    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the command palette' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(host!.querySelector('[class*="windowControlsInset"]')).toBeInTheDocument();
  });

  it('opens the real command palette from the masthead trigger, with the menu commands inside it', () => {
    renderShell(baseProps());
    fireEvent.click(screen.getByRole('button', { name: 'Open the command palette' }));
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(within(dialog).getByRole('option', { name: /New Screenplay/u })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the rail to Library navigation only — no Account/Administration rows, and no second content list (#163, #193)', async () => {
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
    expect(await within(rail).findByRole('button', { name: 'Screenplays' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Breakdowns' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Trash' })).toBeInTheDocument();

    // The 17 Account/Administration rows — and their `Settings:` label prefixes — moved to the
    // settings surface; the rail carries only the Library group now.
    expect(within(rail).queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(rail).queryByText(/Settings:/u)).not.toBeInTheDocument();

    // #193: the rail is navigation, not a second content list. The recency/pinning working set
    // duplicated the list beside it, had no breakdown equivalent, and brought a second search
    // box that the content header already provided.
    expect(within(rail).queryByRole('button', { name: 'Nightfall' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Salt Flats' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Filter screenplays' })).not.toBeInTheDocument();
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

  it('resolves every legacy management URL to the matching section of one modal', async () => {
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

    const initial = baseProps({ route: '/breakdowns/b0c1-d2e3/manage' });
    const { rerender } = renderShell(initial);

    const remount = (props: ReturnType<typeof baseProps>) =>
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <DashboardShell {...props} />
        </QueryClientProvider>,
      );

    for (const [route, section] of [
      ['/breakdowns/b0c1-d2e3/manage', 'Details'],
      ['/breakdowns/b0c1-d2e3/manage/share', 'Share'],
      ['/breakdowns/b0c1-d2e3/manage/structure', 'Entities & fields'],
    ] as const) {
      const props = baseProps({ route });
      remount(props);
      expect(await screen.findByRole('heading', { name: 'Breakdowns' })).toBeVisible();
      const dialog = await screen.findByRole('dialog', { name: 'The Quiet Signal' });
      expect(within(dialog).getByRole('heading', { name: section, level: 1 })).toBeVisible();
      expect(within(dialog).getByRole('button', { name: section })).toHaveAttribute(
        'aria-current',
        'page',
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.onNavigate).toHaveBeenCalledWith('/breakdowns');
    }
  });

  it('opens settings from the rail without duplicating the masthead identity control', () => {
    const props = baseProps();
    renderShell(props);
    const rail = within(screen.getByRole('complementary', { name: 'Sidebar' }));

    fireEvent.click(rail.getByRole('button', { name: 'Settings' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/account');
    expect(rail.queryByRole('button', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
  });
});
