// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DangerSection } from './SpaceSettingsDanger';
import type { ManagedSpace, SpaceRole } from './space-settings-model';

const ownerRole: SpaceRole = {
  id: 'owner-role',
  name: 'Owner',
  description: null,
  isOwner: true,
  version: 1,
  resourceTier: 'manager',
  permissions: [{ permission: 'delete_space' }],
  _count: { memberships: 1 },
};

const memberRole: SpaceRole = {
  id: 'member-role',
  name: 'Member',
  description: null,
  isOwner: false,
  version: 1,
  resourceTier: 'contributor',
  permissions: [{ permission: 'read_space' }],
  _count: { memberships: 1 },
};

function managedSpace(overrides: Partial<ManagedSpace> = {}): ManagedSpace {
  return {
    id: 'space-1',
    name: 'Production',
    description: null,
    ownerUserId: 'owner-user',
    isDefault: false,
    version: 3,
    roles: [ownerRole, memberRole],
    memberships: [
      {
        id: 'owner-membership',
        version: 1,
        user: { id: 'owner-user', displayName: 'Owner', email: 'owner@example.com' },
        role: ownerRole,
      },
      {
        id: 'member-membership',
        version: 1,
        user: { id: 'member-user', displayName: 'Director', email: 'director@example.com' },
        role: memberRole,
      },
    ],
    invitations: [],
    currentMembership: {
      id: 'owner-membership',
      roleId: ownerRole.id,
      permissions: ['delete_space'],
    },
    _count: { resources: 0 },
    ...overrides,
  };
}

function renderDanger(space: ManagedSpace) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <DangerSection space={space} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return onDeleted;
}

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SpaceSettingsDanger', () => {
  it('explains why ownership transfer and deletion are unavailable for the Default Space', () => {
    renderDanger(
      managedSpace({
        name: 'Default Space',
        ownerUserId: 'owner-user',
        isDefault: true,
        roles: [],
        memberships: [],
        currentMembership: null,
      }),
    );

    expect(screen.getByText(/personal Default Space is tied to this account/i)).toBeInTheDocument();
    expect(screen.getByText('The Default Space cannot be deleted.')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled for the Default Space.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'New owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Space…/i })).not.toBeInTheDocument();
  });

  it('explains owner-only transfer and resource-blocked deletion to another member', () => {
    renderDanger(
      managedSpace({
        currentMembership: {
          id: 'member-membership',
          roleId: memberRole.id,
          permissions: ['read_space'],
        },
        _count: { resources: 2 },
      }),
    );

    expect(
      screen.getByText('Only the current owner-role member can transfer ownership.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Move all 2 resources into another Space before deleting this one.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Move resources first or obtain deletion permission.'),
    ).toBeInTheDocument();
  });

  it('lets the current owner transfer ownership and confirm deletion of an empty Space', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/spaces/space-1/transfer-ownership' && init?.method === 'POST') {
        return response({ id: 'space-1' });
      }
      if (path === '/api/v1/spaces/space-1' && init?.method === 'DELETE') {
        return response({ id: 'space-1' });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = renderDanger(managedSpace());

    fireEvent.click(screen.getByRole('button', { name: 'New owner' }));
    fireEvent.click(
      await screen.findByRole('option', { name: /Director — director@example.com/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/spaces/space-1/transfer-ownership',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ newOwnerMembershipId: 'member-membership', version: 3 }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete Space…/i }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Space?' });
    expect(within(dialog).getByText('Production')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Space' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/spaces/space-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
