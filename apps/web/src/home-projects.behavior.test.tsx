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
  it('groups projects and delegates open, manage, create, and local navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/auth/session')
          return envelope({ id: 'user', displayName: 'User', email: 'user@example.com' });
        if (path === '/api/v1/projects') return envelope([owned, shared]);
        if (path === '/api/v1/projects/trash') return envelope([]);
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const onOpen = vi.fn();
    const onManage = vi.fn();
    const onCreate = vi.fn();
    const onPageChange = vi.fn();
    renderWithQuery(
      <ProjectsScreen
        onOpen={onOpen}
        onManage={onManage}
        onCreate={onCreate}
        onPageChange={onPageChange}
      />,
    );
    await screen.findByText('Owned Film');
    fireEvent.click(screen.getByRole('button', { name: /Owned Film/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('button', { name: 'New breakdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(onOpen).toHaveBeenCalledWith('owned');
    expect(onManage).toHaveBeenCalledWith('owned');
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onPageChange).toHaveBeenCalledWith('deleted');
  });

  it('restores and permanently deletes only after destructive confirmation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/auth/session') return envelope({ id: 'user' });
      if (path === '/api/v1/projects') return envelope([]);
      if (path === '/api/v1/projects/trash') return envelope([trashed]);
      if (init?.method === 'POST' || init?.method === 'DELETE') return envelope({ ok: true });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(
      <ProjectsScreen page="deleted" onOpen={vi.fn()} onManage={vi.fn()} onCreate={vi.fn()} />,
    );
    await screen.findByText('Old Film');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/trashed/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/v1/projects/trashed/purge',
      expect.objectContaining({ method: 'DELETE' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/trashed/purge',
        expect.objectContaining({ method: 'DELETE' }),
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
      onManageProject: vi.fn(),
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

  it('flattens instance settings into the rail and protects it for non-administrators', async () => {
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
      onManageProject: vi.fn(),
      onCreateProject: vi.fn(),
      onOpenScreenplay: vi.fn(),
    };
    const { rerender } = renderWithQuery(<DashboardShell {...props} route="/admin/settings" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Instance settings are unavailable.');
    expect(screen.queryByRole('button', { name: 'Settings: Doctor' })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DashboardShell {...props} isAdministrator route="/admin/settings/storage" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Object storage backend' }),
    ).toBeInTheDocument();

    const rail = within(screen.getByRole('navigation', { name: 'Coda pages' }));
    expect(rail.getByRole('button', { name: 'Settings: Storage' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(rail.getByRole('button', { name: 'Settings: Backups' }));
    expect(navigate).toHaveBeenCalledWith('/admin/settings/backups');
  });
});
