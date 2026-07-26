// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allScreenplayPermissions, type ScreenplayPermission } from '@coda/contracts';
import { ScreenplayManagementScreen } from './ScreenplayManagementScreen';
import type { ManagedScreenplay } from './types';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function managed(overrides: Partial<ManagedScreenplay> = {}): ManagedScreenplay {
  const iso = '2026-07-22T00:00:00.000Z';
  return {
    id: 'sp1',
    title: 'Night Bus',
    filename: 'night-bus.fountain',
    ownerUserId: 'owner',
    version: 3,
    createdAt: iso,
    updatedAt: iso,
    roles: [
      {
        id: 'owner-role',
        name: 'owner',
        isOwner: true,
        position: 0,
        permissions: allScreenplayPermissions.map((permission) => ({ permission })),
        _count: { memberships: 1 },
      },
      {
        id: 'editor-role',
        name: 'editor',
        isOwner: false,
        position: 2,
        permissions: [{ permission: 'read_screenplay' }, { permission: 'edit_screenplay' }],
        _count: { memberships: 1 },
      },
      {
        id: 'viewer-role',
        name: 'viewer',
        isOwner: false,
        position: 3,
        permissions: [{ permission: 'read_screenplay' }],
        _count: { memberships: 0 },
      },
    ],
    memberships: [
      {
        id: 'm-owner',
        version: 1,
        createdAt: iso,
        role: { id: 'owner-role', name: 'owner', isOwner: true },
        user: {
          id: 'owner',
          email: 'owner@example.test',
          displayName: 'Olwen Owner',
          status: 'ACTIVE',
        },
      },
      {
        id: 'm-ed',
        version: 1,
        createdAt: iso,
        role: { id: 'editor-role', name: 'editor', isOwner: false },
        user: {
          id: 'u2',
          email: 'ed@example.test',
          displayName: 'Edward Editor',
          status: 'ACTIVE',
        },
      },
    ],
    invitations: [
      {
        id: 'inv1',
        email: 'pending@example.test',
        status: 'PENDING',
        expiresAt: iso,
        createdAt: iso,
        role: { id: 'viewer-role', name: 'viewer' },
        inviter: { id: 'owner', displayName: 'Olwen Owner' },
      },
    ],
    currentMembership: {
      id: 'm-owner',
      roleId: 'owner-role',
      permissions: [...allScreenplayPermissions],
    },
    ...overrides,
  };
}

function stubFetch(
  payload: ManagedScreenplay,
  extra?: (path: string, init?: RequestInit) => unknown,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = input instanceof Request ? input.url : input.toString();
    const handled = extra?.(path, init);
    if (handled) return handled as Promise<Response>;
    if (path.endsWith('/management')) return response(payload);
    if (path.endsWith('/available-users')) {
      return response([
        { id: 'u3', email: 'new@example.test', displayName: 'Nadia New', status: 'ACTIVE' },
      ]);
    }
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBack = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ScreenplayManagementScreen screenplayId="sp1" onBack={onBack} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onBack, onDeleted };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScreenplayManagementScreen', () => {
  it('renders members, pending invitations, roles, transfer, and danger zone for an owner', async () => {
    stubFetch(managed());
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Night Bus', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Edward Editor')).toBeInTheDocument();
    expect(screen.getByText('pending@example.test')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transfer ownership' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move to trash/ })).toBeInTheDocument();
  });

  it('invites a collaborator by email and reveals the invitation link', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if (path.endsWith('/invitations') && init?.method === 'POST') {
        return response({ id: 'inv2', invitationUrl: '/accept-invitation?token=abc' });
      }
      return undefined;
    });
    renderScreen();
    await screen.findByRole('heading', { name: 'Night Bus', level: 1 });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'collaborator@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([p, init]) => (p as string).endsWith('/invitations') && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call?.[1]?.body as string) ?? '{}') as { email: string };
      expect(body.email).toBe('collaborator@example.test');
    });
    expect(await screen.findByText('Invitation link created')).toBeInTheDocument();
  });

  it('changes a member role through the role select', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if (path.endsWith('/memberships/m-ed') && init?.method === 'PATCH') {
        return response({ id: 'm-ed' });
      }
      return undefined;
    });
    renderScreen();
    await screen.findByText('Edward Editor');
    fireEvent.click(screen.getByRole('button', { name: 'Role for Edward Editor' }));
    fireEvent.click(await screen.findByRole('option', { name: 'viewer' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([p, init]) => (p as string).endsWith('/memberships/m-ed') && init?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call?.[1]?.body as string) ?? '{}') as { roleId: string };
      expect(body.roleId).toBe('viewer-role');
    });
  });

  it('hides invite and add-member controls when the caller cannot invite', async () => {
    const settingsOnly: ScreenplayPermission[] = ['read_screenplay', 'manage_screenplay_settings'];
    stubFetch(
      managed({
        currentMembership: { id: 'm-owner', roleId: 'owner-role', permissions: settingsOnly },
      }),
    );
    renderScreen();
    await screen.findByRole('heading', { name: 'Night Bus', level: 1 });
    expect(screen.queryByRole('button', { name: 'Send invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    // The danger zone remains available to a settings manager.
    expect(screen.getByRole('button', { name: /Move to trash/ })).toBeInTheDocument();
  });

  it('surfaces a retry affordance when management cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ title: 'Nope' }, 403)),
    );
    renderScreen();
    expect(
      await screen.findByRole('heading', { name: /could not be opened/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
