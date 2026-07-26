// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeId } from './themes';
import { ProjectsScreen } from './ProjectsScreen';
import { DashboardShell } from './app-shell/DashboardShell';

const shellChrome = {
  theme: 'coda-dark' as ThemeId,
  isFullscreen: false,
  chooseTheme: () => undefined,
  toggleFullscreen: () => undefined,
  logout: () => undefined,
};

const owned = {
  id: 'owned',
  name: 'Owned Film',
  description: 'Owned project',
  ownerUserId: 'user',
  updatedAt: '2026-07-01T00:00:00.000Z',
  currentMembership: {
    id: 'membership',
    role: {
      id: 'owner-role',
      name: 'Owner',
      permissions: [{ permission: 'manage_project_settings' }],
    },
  },
};

/** An owner who also holds `delete_project`, which is what the trash affordance requires. */
const deletable = {
  ...owned,
  currentMembership: {
    ...owned.currentMembership,
    role: {
      ...owned.currentMembership.role,
      permissions: [{ permission: 'manage_project_settings' }, { permission: 'delete_project' }],
    },
  },
};

const shared = {
  ...owned,
  id: 'shared',
  name: 'Shared Film',
  ownerUserId: 'other',
  currentMembership: {
    ...owned.currentMembership,
    role: { ...owned.currentMembership.role, permissions: [] },
  },
};

const trashed = {
  ...owned,
  id: 'trashed',
  name: 'Old Film',
  deletedAt: '2026-07-01T00:00:00.000Z',
  purgeAfter: '2026-08-01T00:00:00.000Z',
  canRestore: true,
};

const trashedScreenplay = {
  id: 'sp-trash',
  ownerUserId: 'user',
  title: 'Old Draft',
  filename: 'old-draft.fountain',
  deletedAt: '2026-07-03T00:00:00.000Z',
  purgeAfter: '2026-08-02T00:00:00.000Z',
  canRestore: true,
};

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('projects and unified home behavior', () => {
  it('groups projects and delegates open, manage, and create actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/auth/session')
          return envelope({ id: 'user', displayName: 'User', email: 'user@example.com' });
        if (path === '/api/v1/projects') return envelope([owned, shared]);
        if (path === '/api/v1/projects/trash') return envelope([]);
        if (path === '/api/v1/screenplays/trash') return envelope([]);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const onOpen = vi.fn();
    const onManage = vi.fn();
    const onCreate = vi.fn();
    renderWithQuery(<ProjectsScreen onOpen={onOpen} onManage={onManage} onCreate={onCreate} />);
    await screen.findByText('Owned Film');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Breakdowns' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'LibraryBreakdowns2',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Your work' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Shared with you' })).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole('row', { name: 'Owned Film' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Owned Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage breakdown…' }));
    fireEvent.click(screen.getByRole('button', { name: 'New breakdown' }));
    expect(onOpen).toHaveBeenCalledWith('owned');
    expect(onManage).toHaveBeenCalledWith('owned');
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByRole('row', { name: 'Shared Film' })).toBeInTheDocument();
  });

  it('presents management on its Share section over the list and confirms moving to trash', async () => {
    const managed = {
      id: 'owned',
      name: 'Owned Film',
      description: null,
      ownerUserId: 'user',
      version: 1,
      entityTypes: [],
      roles: [],
      memberships: [],
      currentMembership: { id: 'membership', roleId: 'owner-role', permissions: [] },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/auth/session')
        return envelope({ id: 'user', displayName: 'User', email: 'user@example.com' });
      if (path === '/api/v1/projects') return envelope([deletable]);
      if (path === '/api/v1/projects/trash') return envelope([]);
      if (path === '/api/v1/screenplays/trash') return envelope([]);
      if (path === '/api/v1/projects/owned/management') return envelope(managed);
      if (init?.method === 'DELETE') return envelope({ ok: true });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCloseManagement = vi.fn();
    renderWithQuery(
      <ProjectsScreen
        onOpen={vi.fn()}
        onManage={vi.fn()}
        onCreate={vi.fn()}
        managementProjectId="owned"
        managementSection="share"
        onCloseManagement={onCloseManagement}
      />,
    );

    // The library is the surface; the modal is presented over it.
    await screen.findByText('Owned Film');
    const management = await screen.findByRole('dialog', { name: 'Owned Film' });
    expect(management).toHaveAttribute('aria-modal', 'true');
    expect(within(management).getByRole('heading', { name: 'Share' })).toBeInTheDocument();
    expect(within(management).getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onCloseManagement).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Owned Film' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
    const confirm = await screen.findByRole('dialog', { name: 'Move breakdown to trash?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/owned/trash',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('restores and permanently deletes only after destructive confirmation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/auth/session') return envelope({ id: 'user' });
      if (path === '/api/v1/projects') return envelope([]);
      if (path === '/api/v1/projects/trash') return envelope([trashed]);
      if (path === '/api/v1/screenplays/trash') return envelope([trashedScreenplay]);
      if (init?.method === 'POST' || init?.method === 'DELETE') return envelope({ ok: true });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(
      <ProjectsScreen page="deleted" onOpen={vi.fn()} onManage={vi.fn()} onCreate={vi.fn()} />,
    );
    await screen.findByText('Old Film');
    const openMenu = async (item: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Old Film' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: item }));
    };
    await openMenu('Restore');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/trashed/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await openMenu('Delete permanently…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/v1/projects/trashed/purge',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await openMenu('Delete permanently…');
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/trashed/purge',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );

    // The trash list is a union: screenplays restore through their own endpoint.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old Draft' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/screenplays/sp-trash/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('routes rail actions and protects administrator-only pages', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const navigate = vi.fn();
    const props = {
      ...shellChrome,
      isAdministrator: false,
      onNavigate: navigate,
      onOpenProject: vi.fn(),
      onCreateProject: vi.fn(),
      onOpenScreenplay: vi.fn(),
    };
    const { rerender } = renderWithQuery(<DashboardShell {...props} route="/admin/users" />);
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(navigate).toHaveBeenCalledWith('/trash');

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...props} isAdministrator route="/account/security" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Breakdowns' })[0]!);
    expect(navigate).toHaveBeenCalledWith('/breakdowns');
  });

  it('gives instance settings their own settings-surface sub-nav group, protected for non-administrators (#163)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const navigate = vi.fn();
    const props = {
      ...shellChrome,
      isAdministrator: false,
      onNavigate: navigate,
      onOpenProject: vi.fn(),
      onCreateProject: vi.fn(),
      onOpenScreenplay: vi.fn(),
    };
    const { rerender } = renderWithQuery(<DashboardShell {...props} route="/admin/settings" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Instance settings are unavailable.');
    // Instance Settings drops out of the sub-nav entirely for a non-administrator — there is no
    // `Settings: Doctor`-style label anywhere any more, prefixed or not.
    expect(screen.queryByRole('button', { name: 'Doctor' })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...props} isAdministrator route="/admin/settings/storage" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Object storage backend' }),
    ).toBeInTheDocument();

    // The rail itself no longer carries any Administration/Instance Settings rows (#163) — the
    // sub-nav lives on the settings surface instead.
    const rail = within(screen.getByRole('navigation', { name: 'Coda pages' }));
    expect(rail.queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument();

    const settingsNav = screen.getByRole('navigation', { name: 'Settings pages' });
    // Administration's own "Storage" (usage) and Instance Settings' "Storage" (backend config)
    // now share a bare label — dropping the `Settings:` prefix means the group heading, not the
    // name, is what tells them apart.
    expect(within(settingsNav).getAllByRole('button', { name: 'Storage' })).toHaveLength(2);
    const instanceSettingsGroup = settingsNav.querySelector(
      '[data-settings-group="instance-settings"]',
    );
    expect(instanceSettingsGroup).not.toBeNull();
    const current = within(instanceSettingsGroup as HTMLElement).getByRole('button', {
      current: 'page',
    });
    expect(current).toHaveTextContent('Storage');

    fireEvent.click(
      within(instanceSettingsGroup as HTMLElement).getByRole('button', { name: 'Backups' }),
    );
    expect(navigate).toHaveBeenCalledWith('/admin/settings/backups');
  });
});
