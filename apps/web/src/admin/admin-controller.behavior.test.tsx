// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDialogs, AdminPageBody } from './AdminScreenViews';
import type { AdminPage, InstanceManagementSummary, InstanceUser } from './types';
import { useAdminController } from './useAdminController';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  api: apiMock,
  ApiError: class MockApiError extends Error {},
}));

const activeUser: InstanceUser = {
  id: 'user-active',
  displayName: 'Active Member',
  email: 'active@example.com',
  company: null,
  department: null,
  status: 'ACTIVE',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  _count: { memberships: 1, sessions: 2, ownedProjects: 0 },
};

const disabledUser: InstanceUser = {
  ...activeUser,
  id: 'user-disabled',
  displayName: 'Disabled Member',
  email: 'disabled@example.com',
  status: 'DISABLED',
};

const management = {
  initializedAt: '2026-01-01T00:00:00.000Z',
  retentionDays: 30,
  owner: { id: 'owner', displayName: 'Owner', email: 'owner@example.com' },
  counts: {
    users: 2,
    activeUsers: 1,
    disabledUsers: 1,
    activeProjects: 0,
    trashedProjects: 0,
    activeSessions: 2,
    storageObjects: 0,
    storageBytes: 0,
    trashedStorageObjects: 0,
    trashedStorageBytes: 0,
    pendingInvitations: 0,
    jobs: 0,
  },
  system: {
    sampledAt: '2026-07-01T00:00:00.000Z',
    runtime: {
      state: 'running',
      nodeVersion: 'v22',
      processUptimeSeconds: 10,
      eventLoopUtilizationPercent: 1,
      memory: { rssBytes: 1, heapUsedBytes: 1, heapTotalBytes: 1, externalBytes: 1 },
    },
    operatingSystem: { platform: 'win32', release: '11', architecture: 'x64', uptimeSeconds: 20 },
    cpu: {
      usagePercent: 1,
      logicalCores: 8,
      model: 'CPU',
      loadAverage: { oneMinute: 0, fiveMinutes: 0, fifteenMinutes: 0 },
    },
    memory: { totalBytes: 10, usedBytes: 2, freeBytes: 8, usagePercent: 20 },
    disk: { available: false },
    history: [],
  },
  jobs: [],
  users: [],
  projects: [],
  storageItems: [],
  activities: [],
} satisfies InstanceManagementSummary;

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function installDefaultApi() {
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/v1/health/ready') return {};
    if (path === '/api/v1/instance/management') return management;
    if (path.includes('/invitation-options')) {
      return {
        delivery: 'manual_link',
        defaultExpiry: 'never',
        expiryChoices: [],
        projects: [{ id: 'project', name: 'Film', roles: [{ id: 'role', name: 'Editor' }] }],
      };
    }
    if (path.includes('/management/invitations') && init?.method === 'POST') {
      return {
        email: null,
        isReusable: true,
        invitationUrl: '/invitations/token',
        expiresAt: '2026-08-01T00:00:00.000Z',
      };
    }
    if (path.includes('/management/activities')) {
      const cursor = new URL(path, 'https://coda.test').searchParams.get('cursor');
      return { items: [], nextCursor: cursor ? null : 'next-page' };
    }
    if (path.includes('/management/users')) {
      return { items: [activeUser, disabledUser], nextCursor: null };
    }
    if (path.includes('/management/')) return { items: [], nextCursor: null };
    if (path.includes('/status') && init?.method === 'PATCH') {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
        status: 'ACTIVE' | 'DISABLED';
      };
      const { status } = body;
      const user = status === 'ACTIVE' ? { ...disabledUser, status } : { ...activeUser, status };
      return { user, sessionsRevoked: status === 'ACTIVE' ? 0 : 2 };
    }
    return {};
  });
}

function AdminHarness({ page }: { page: AdminPage }) {
  const controller = useAdminController(page);
  return (
    <>
      <AdminPageBody activePage={page} controller={controller} onPageChange={vi.fn()} />
      <AdminDialogs controller={controller} />
    </>
  );
}

beforeEach(() => {
  apiMock.mockReset();
  installDefaultApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAdminController', () => {
  it('guards invalid invitations, creates a reusable invitation, and reports clipboard failure', async () => {
    const client = queryClient();
    const { result } = renderHook(() => useAdminController('invitations'), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.setInviteKind('bulk');
      result.current.setInviteExpiry('never');
      result.current.submitInvite({ preventDefault: vi.fn() } as never);
    });
    expect(apiMock).not.toHaveBeenCalledWith(
      '/api/v1/instance/management/invitations/bulk',
      expect.anything(),
    );

    act(() => {
      result.current.setInviteExpiry('7_days');
      result.current.setInviteMembership('project');
      result.current.submitInvite({ preventDefault: vi.fn() } as never);
    });
    expect(apiMock).not.toHaveBeenCalledWith(
      '/api/v1/instance/management/invitations/bulk',
      expect.anything(),
    );

    act(() => {
      result.current.setInviteProjectId('project');
      result.current.setInviteRoleId('role');
    });
    act(() => result.current.submitInvite({ preventDefault: vi.fn() } as never));

    await waitFor(() => expect(result.current.inviteMutation.isSuccess).toBe(true));
    expect(apiMock).toHaveBeenCalledWith('/api/v1/instance/management/invitations/bulk', {
      method: 'POST',
      body: JSON.stringify({ expiresIn: '7_days', projectId: 'project', roleId: 'role' }),
    });
    expect(result.current.createdInvitation).toMatchObject({
      isReusable: true,
      url: 'http://localhost:3000/invitations/token',
    });
    expect(result.current.inviteMembership).toBe('none');

    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await act(() => result.current.copyInvitation());
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/invitations/token');
    expect(result.current.copyState).toBe('failed');
    client.clear();
  });

  it('validates password resets and handles account enable success and failure feedback', async () => {
    const client = queryClient();
    const { result } = renderHook(() => useAdminController('users'), {
      wrapper: wrapper(client),
    });

    act(() => {
      result.current.setResetUser(activeUser);
      result.current.setResetPassword('short');
      result.current.setResetConfirmation('short');
      result.current.submitReset({ preventDefault: vi.fn() } as never);
    });
    expect(apiMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/reset-password'),
      expect.anything(),
    );

    act(() => {
      result.current.setResetPassword('long-enough-1');
      result.current.setResetConfirmation('long-enough-1');
    });
    act(() => result.current.submitReset({ preventDefault: vi.fn() } as never));
    await waitFor(() => expect(result.current.resetMutation.isSuccess).toBe(true));
    expect(apiMock).toHaveBeenCalledWith('/api/v1/instance/users/user-active/reset-password', {
      method: 'POST',
      body: JSON.stringify({ password: 'long-enough-1' }),
    });
    expect(result.current.resetUser).toBeNull();

    act(() => result.current.changeUserStatus(activeUser));
    expect(result.current.disableUser).toEqual(activeUser);

    act(() => result.current.changeUserStatus(disabledUser));
    await waitFor(() => expect(result.current.userStatusMutation.isSuccess).toBe(true));
    expect(result.current.userStatusFeedback).toEqual({
      kind: 'success',
      message: 'Disabled Member is now enabled.',
    });

    apiMock.mockImplementationOnce(() => Promise.reject(new Error('permission denied')));
    act(() => {
      result.current.userStatusMutation.mutate({ userId: disabledUser.id, status: 'ACTIVE' });
    });
    await waitFor(() => expect(result.current.userStatusMutation.isError).toBe(true));
    expect(result.current.userStatusFeedback).toEqual({
      kind: 'error',
      message: 'The account status could not be changed.',
    });
    client.clear();
  });

  it('maps audit requests, trims search input, and follows the returned cursor', async () => {
    const client = queryClient();
    const { result } = renderHook(() => useAdminController('audit'), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.list.hasNextPage).toBe(true));

    await act(() => result.current.list.fetchNextPage());
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringMatching(/management\/activities\?limit=50&cursor=next-page$/),
    );

    act(() => result.current.setSearch('  changed item  '));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        expect.stringMatching(/management\/activities\?limit=50&search=changed\+item$/),
      ),
    );
    client.clear();
  });
});

describe('admin management screens', () => {
  it('requires confirmation before disabling a user and displays the mutation result', async () => {
    const client = queryClient();
    render(<AdminHarness page="users" />, { wrapper: wrapper(client) });

    expect(await screen.findByText('Active Member')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.getByRole('dialog', { name: 'Disable this account?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disable account' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Active Member is now disabled. 2 active sessions were revoked.',
    );
    expect(apiMock).toHaveBeenCalledWith('/api/v1/instance/users/user-active/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    client.clear();
  });

  it('surfaces authorization failures and lets the administrator retry', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/v1/health/ready') return {};
      if (path === '/api/v1/instance/management') throw new Error('forbidden');
      return { items: [], nextCursor: null };
    });
    const client = queryClient();
    render(<AdminHarness page="projects" />, { wrapper: wrapper(client) });

    expect(
      await screen.findByRole('heading', { name: 'Instance management is unavailable.' }),
    ).toBeInTheDocument();
    const before = apiMock.mock.calls.filter(
      ([path]) => path === '/api/v1/instance/management',
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      const after = apiMock.mock.calls.filter(
        ([path]) => path === '/api/v1/instance/management',
      ).length;
      expect(after).toBeGreaterThan(before);
    });
    client.clear();
  });
});
