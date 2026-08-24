// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allTrackerPermissions, type TrackerPermission } from '@coda/contracts';
import { TrackerShareDialog } from './TrackerShareDialog';
import type { ManagedTracker } from './types';

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function managed(overrides: Partial<ManagedTracker> = {}): ManagedTracker {
  const iso = '2026-07-22T00:00:00.000Z';
  return {
    id: 'tk1',
    name: 'Shot Log',
    description: null,
    ownerUserId: 'owner',
    version: 4,
    createdAt: iso,
    updatedAt: iso,
    roles: [
      {
        id: 'owner-role',
        name: 'owner',
        isOwner: true,
        position: 0,
        version: 1,
        description: null,
        permissions: allTrackerPermissions.map((permission) => ({ permission })),
        _count: { memberships: 1 },
      },
      {
        id: 'editor-role',
        name: 'editor',
        isOwner: false,
        position: 2,
        version: 2,
        description: null,
        permissions: [
          { permission: 'read_tracker' },
          { permission: 'edit_tracker_records' },
          { permission: 'invite_members' },
        ],
        _count: { memberships: 1 },
      },
      {
        id: 'viewer-role',
        name: 'viewer',
        isOwner: false,
        position: 3,
        version: 1,
        description: null,
        permissions: [{ permission: 'read_tracker' }],
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
      permissions: [...allTrackerPermissions],
    },
    ...overrides,
  };
}

function stubFetch(
  payload: ManagedTracker,
  extra?: (path: string, init?: RequestInit) => unknown,
): FetchMock {
  const fetchMock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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

function renderDialog(sourceSpaceId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrackerShareDialog trackerId="tk1" sourceSpaceId={sourceSpaceId} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

/**
 * Expands one role editor and returns it. The lookup goes through the `summary` element because
 * role names also appear in member-row selects outside the Roles band.
 */
function openDetails(label: string): HTMLElement {
  const summary = screen
    .getAllByText(label)
    .find((element) => element.closest('summary') !== null);
  if (!summary) throw new Error(`No disclosure named ${label}`);
  fireEvent.click(summary);
  return summary.closest('details') as HTMLElement;
}

function openRole(name: string): HTMLElement {
  return openDetails(name);
}

function postedCalls(fetchMock: FetchMock, suffix: string) {
  return fetchMock.mock.calls.filter(
    ([path, init]) => (path as string).endsWith(suffix) && init?.method === 'POST',
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TrackerShareDialog permission-aware visibility', () => {
  it('renders members, pending invitations, editable roles, and transfer for an owner', async () => {
    stubFetch(managed());
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    expect(screen.getByText('Edward Editor')).toBeInTheDocument();
    expect(screen.getByText('pending@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument();

    const editor = within(openRole('editor'));
    expect(editor.getByLabelText('Manage fields')).toBeEnabled();
    // The subset rule in the UI: a checkbox the caller cannot grant stays locked.
    expect(editor.getByLabelText('Invite members')).not.toBeDisabled();
    const viewer = within(openRole('viewer'));
    // Archiving is offered while empty and refused while members remain.
    expect(viewer.getByRole('button', { name: 'Archive role…' })).toBeEnabled();
    expect(editor.getByRole('button', { name: 'Archive role…' })).toBeDisabled();
    expect(editor.getByText('Reassign this role’s members before archiving it.'));

    expect(
      screen.getByRole('button', { name: 'Revoke invitation for pending@example.test' }),
    ).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Transfer ownership' })).toBeInTheDocument();
  });

  it('hides mutation controls from a settings manager who can still read the roster', async () => {
    const settingsOnly: TrackerPermission[] = ['read_tracker', 'manage_tracker_settings'];
    stubFetch(
      managed({ currentMembership: { id: 'm-owner', roleId: 'o', permissions: settingsOnly } }),
    );
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    expect(screen.queryByRole('button', { name: 'Send invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.queryByText('Create role')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Transfer ownership' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Edward Editor' })).toBeDisabled();
    // The roster stays readable to a settings manager who cannot change it.
    expect(screen.getByText('Edward Editor')).toBeInTheDocument();
  });

  it('locks member-role changes and removals for an inviter without role authority', async () => {
    const inviterOnly: TrackerPermission[] = ['read_tracker', 'invite_members'];
    stubFetch(
      managed({ currentMembership: { id: 'm-ed', roleId: 'r', permissions: inviterOnly } }),
    );
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Role for Edward Editor' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Edward Editor' })).toBeDisabled();
    expect(screen.queryByText('Create role')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Transfer ownership' })).not.toBeInTheDocument();
  });

  it('offers a roles manager role editing but no membership or invitation forms', async () => {
    const rolesOnly: TrackerPermission[] = ['read_tracker', 'manage_roles'];
    stubFetch(managed({ currentMembership: { id: 'm-ed', roleId: 'r', permissions: rolesOnly } }));
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invitation' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Create role').length).toBeGreaterThan(0);
    const editor = within(openRole('editor'));
    // The editor role grants edit_tracker_records and invite_members, which this caller does not
    // hold — so its whole permission set locks read-only rather than letting a partial edit.
    expect(editor.getByLabelText('Read tracker')).toBeDisabled();
    expect(
      editor.getByText(
        'This role holds permissions you do not have, so its permission set is read-only.',
      ),
    ).toBeInTheDocument();
  });
});

describe('TrackerShareDialog membership flows', () => {
  it('adds a registered user under the chosen role', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/memberships') && init?.method === 'POST')
        return response({ id: 'm-new' });
      return undefined;
    });
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => {
      const calls = postedCalls(fetchMock, '/memberships');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse((calls[0]?.[1] as RequestInit).body as string)).toEqual({
        userId: 'u3',
        roleId: 'editor-role',
      });
    });
  });

  it('confirms before removing a member rather than acting on the click', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/memberships/m-ed') && init?.method === 'DELETE')
        return response({ id: 'm-ed' });
      return undefined;
    });
    renderDialog();
    await screen.findByText('Edward Editor');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Edward Editor' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Remove Edward Editor?' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove member' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path, init]) =>
          (path as string).endsWith('/memberships/m-ed') && init?.method === 'DELETE',
      );
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ version: 1 });
    });
  });

  it('changes a member role through the role select', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/memberships/m-ed') && init?.method === 'PATCH')
        return response({ id: 'm-ed' });
      return undefined;
    });
    renderDialog();
    await screen.findByText('Edward Editor');
    fireEvent.click(screen.getByRole('button', { name: 'Role for Edward Editor' }));
    fireEvent.click(await screen.findByRole('option', { name: 'viewer' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path, init]) =>
          (path as string).endsWith('/memberships/m-ed') && init?.method === 'PATCH',
      );
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
        roleId: 'viewer-role',
        version: 1,
      });
    });
  });
});

describe('TrackerShareDialog role flows', () => {
  it('surfaces the API subset refusal when a created role would exceed the caller', async () => {
    stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/roles') && init?.method === 'POST') {
        return response(
          { title: 'Conflict', detail: 'Cannot grant permissions you do not hold', status: 409 },
          409,
        );
      }
      return undefined;
    });
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    const createForm = within(openDetails('Create role'));
    fireEvent.change(createForm.getByLabelText('Role name'), {
      target: { value: 'Supervisor' },
    });
    fireEvent.click(createForm.getByLabelText('Read tracker'));
    fireEvent.click(createForm.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText(/Cannot grant permissions you do not hold/)).toBeInTheDocument();
  });

  it('creates a custom role with the checked permission set', async () => {
    const limitedGrants: TrackerPermission[] = ['read_tracker', 'manage_roles'];
    const fetchMock = stubFetch(
      managed({
        currentMembership: {
          id: 'm-owner',
          roleId: 'owner-role',
          permissions: limitedGrants,
        },
      }),
      (path, init) => {
        if ((path).endsWith('/roles') && init?.method === 'POST')
          return response({ id: 'role-new', name: 'Supervisor' });
        return undefined;
      },
    );
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    const createForm = within(openDetails('Create role'));
    // The create form's checkboxes lock one by one: this caller cannot grant what they lack.
    expect(createForm.getByLabelText('Read tracker')).toBeEnabled();
    expect(createForm.getByLabelText('Edit records')).toBeDisabled();
    fireEvent.change(createForm.getByLabelText('Role name'), {
      target: { value: 'Supervisor' },
    });
    fireEvent.click(createForm.getByLabelText('Read tracker'));
    fireEvent.click(createForm.getByRole('button', { name: 'Create role' }));
    await waitFor(() => {
      const calls = postedCalls(fetchMock, '/roles');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse((calls[0]?.[1] as RequestInit).body as string)).toEqual({
        name: 'Supervisor',
        description: null,
        permissions: ['read_tracker'],
      });
    });
  });

  it('saves an edited custom role against its version', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/roles/viewer-role') && init?.method === 'PATCH')
        return response({ id: 'viewer-role' });
      return undefined;
    });
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    const viewer = within(openRole('viewer'));
    fireEvent.change(viewer.getByLabelText('Description'), {
      target: { value: 'Read only' },
    });
    fireEvent.click(viewer.getByRole('button', { name: 'Save role' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path, init]) =>
          (path as string).endsWith('/roles/viewer-role') && init?.method === 'PATCH',
      );
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
        name: 'viewer',
        description: 'Read only',
        version: 1,
      });
    });
  });
});

describe('TrackerShareDialog invitation flows', () => {
  it('creates an invitation, reveals the link, and copies it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/invitations') && init?.method === 'POST') {
        return response({ id: 'inv2', invitationUrl: '/accept-invitation?token=abc' });
      }
      return undefined;
    });
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'collaborator@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Invitation link created')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/accept-invitation?token=abc'));
  });

  it('confirms before revoking a pending invitation', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/invitations/inv1') && init?.method === 'DELETE')
        return response({ id: 'inv1' });
      return undefined;
    });
    renderDialog();
    await screen.findByText('pending@example.test');
    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke invitation for pending@example.test' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Revoke the invitation for pending@example.test?',
    });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Revoke invitation' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    });
  });
});

describe('TrackerShareDialog ownership transfer', () => {
  it('transfers through an explicit confirmation that names the demotion', async () => {
    const fetchMock = stubFetch(managed(), (path, init) => {
      if ((path).endsWith('/transfer-ownership') && init?.method === 'POST')
        return response({ id: 'tk1' });
      return undefined;
    });
    renderDialog();
    await screen.findByRole('dialog', { name: 'Shot Log' });
    fireEvent.click(screen.getByRole('button', { name: 'New owner' }));
    fireEvent.click(await screen.findByRole('option', { name: /Edward Editor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership…' }));

    const confirmation = await screen.findByRole('dialog', {
      name: 'Transfer ownership to Edward Editor?',
    });
    expect(confirmation).toHaveTextContent(/demoted/i);
    expect(postedCalls(fetchMock, '/transfer-ownership')).toHaveLength(0);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => {
      const calls = postedCalls(fetchMock, '/transfer-ownership');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse((calls[0]?.[1] as RequestInit).body as string)).toEqual({
        newOwnerMembershipId: 'm-ed',
        version: 4,
      });
    });
  });
});

describe('TrackerShareDialog states', () => {
  it('offers a retry affordance when management cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ title: 'Nope' }, 403)),
    );
    renderDialog();
    expect(await screen.findByText(/Sharing could not be opened/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('presents the move-to-space entry when reached from inside a Space', async () => {
    stubFetch(managed());
    renderDialog('space-1');
    await screen.findByRole('dialog', { name: 'Shot Log' });
    expect(screen.getByRole('heading', { name: 'Move to Space' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Space…' })).toBeInTheDocument();
  });
});
