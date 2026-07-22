// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminDialogs, AdminPageBody } from './AdminScreenViews';
import type { ManagementListQuery } from './AdminCommon';
import type { ManagementListItem } from './types';
import type { AdminController } from './useAdminController';

function query(items: ManagementListItem[] = []) {
  return {
    data: { pages: [{ items, nextCursor: null }], pageParams: [] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } satisfies Partial<ManagementListQuery>;
}
const management = {
  owner: { id: 'owner', displayName: 'Owner', email: 'owner@example.com' },
  counts: {
    users: 1,
    activeUsers: 1,
    disabledUsers: 0,
    activeProjects: 1,
    trashedProjects: 0,
    activeSessions: 1,
    storageObjects: 1,
    invitations: 0,
    jobs: 1,
  },
  users: [],
  projects: [],
  storage: [],
  invitations: [],
  jobs: [],
  activities: [],
};
function controller(overrides: Record<string, unknown> = {}): AdminController {
  return {
    management: { data: management, isLoading: false, error: null, refetch: vi.fn() },
    liveStatus: { data: undefined },
    readiness: { state: 'ready', label: 'Ready' },
    jobs: { data: [], isLoading: false, error: null, refetch: vi.fn() },
    list: query(),
    listItems: [],
    invitationOptions: { data: undefined, isLoading: false },
    inviteEmail: '',
    inviteKind: 'single',
    inviteExpiry: 'never',
    inviteMembership: 'none',
    inviteProjectId: '',
    inviteRoleId: '',
    createdInvitation: undefined,
    copyState: 'idle',
    inviteMutation: { isPending: false, error: null },
    submitInvite: vi.fn(),
    setInviteEmail: vi.fn(),
    setInviteKind: vi.fn(),
    setInviteExpiry: vi.fn(),
    setInviteMembership: vi.fn(),
    setInviteProjectId: vi.fn(),
    setInviteRoleId: vi.fn(),
    copyInvitation: vi.fn(),
    setRevokeInvitation: vi.fn(),
    userStatusFeedback: undefined,
    userStatusMutation: {
      variables: undefined,
      isPending: false,
      error: null,
      reset: vi.fn(),
      mutate: vi.fn(),
    },
    resetMutation: { isPending: false, error: null, reset: vi.fn() },
    changeUserStatus: vi.fn(),
    setResetUser: vi.fn(),
    resetUser: null,
    resetPassword: '',
    resetConfirmation: '',
    setResetPassword: vi.fn(),
    setResetConfirmation: vi.fn(),
    submitReset: vi.fn(),
    revokeInvitation: null,
    revokeMutation: { isPending: false, error: null, reset: vi.fn(), mutate: vi.fn() },
    disableUser: null,
    setUserStatusFeedback: vi.fn(),
    setDisableUser: vi.fn(),
    ...overrides,
  } as unknown as AdminController;
}

afterEach(cleanup);

describe('additional admin screen view states', () => {
  it('routes every management page and covers job loading, failure, and rows', () => {
    for (const page of ['overview', 'projects', 'storage', 'audit', 'invitations'] as const) {
      const view = render(
        <AdminPageBody activePage={page} controller={controller()} onPageChange={vi.fn()} />,
      );
      expect(view.container.firstChild).toBeTruthy();
      view.unmount();
    }
    const loading = render(
      <AdminPageBody
        activePage="jobs"
        controller={controller({ jobs: { isLoading: true, error: null } })}
        onPageChange={vi.fn()}
      />,
    );
    expect(loading.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    loading.unmount();
    const failed = render(
      <AdminPageBody
        activePage="jobs"
        controller={controller({ jobs: { isLoading: false, error: new Error('offline') } })}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Jobs could not be loaded.')).toBeInTheDocument();
    failed.unmount();
    render(
      <AdminPageBody
        activePage="jobs"
        controller={controller({ jobs: { isLoading: false, error: null, data: [] } })}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No background jobs')).toBeInTheDocument();
  });

  it('renders success and error status feedback for user actions', () => {
    const success = render(
      <AdminPageBody
        activePage="users"
        controller={controller({ userStatusFeedback: { kind: 'success', message: 'Enabled' } })}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Enabled');
    success.unmount();
    render(
      <AdminPageBody
        activePage="users"
        controller={controller({ userStatusFeedback: { kind: 'error', message: 'Denied' } })}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Denied');
  });

  it('normalizes dependent invitation choices in the page adapter', () => {
    const adapted = controller({
      invitationOptions: {
        isLoading: false,
        data: {
          delivery: 'manual_link',
          defaultExpiry: 'never',
          expiryChoices: [
            { id: 'never', label: 'Never expires' },
            { id: '7_days', label: '7 days' },
          ],
          projects: [{ id: 'project', name: 'Film', roles: [{ id: 'role', name: 'Editor' }] }],
        },
      },
      inviteKind: 'email',
      inviteExpiry: 'never',
      inviteMembership: 'project',
      inviteProjectId: 'project',
      inviteRoleId: 'role',
    });
    render(<AdminPageBody activePage="invitations" controller={adapted} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invitation link type' }));
    fireEvent.click(screen.getByRole('option', { name: 'Reusable bulk link' }));
    expect(adapted.setInviteKind).toHaveBeenCalledWith('bulk');
    expect(adapted.setInviteExpiry).toHaveBeenCalledWith('7_days');
    fireEvent.click(screen.getByRole('button', { name: 'Breakdown membership assignment' }));
    fireEvent.click(screen.getByRole('option', { name: 'None' }));
    expect(adapted.setInviteProjectId).toHaveBeenCalledWith('');
    expect(adapted.setInviteRoleId).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'Invitation breakdown' }));
    fireEvent.click(screen.getByRole('option', { name: 'Film' }));
    expect(adapted.setInviteProjectId).toHaveBeenCalledWith('project');
  });

  it('wires password reset and both reusable and personal revocation dialogs', () => {
    const resetUser = { id: 'user', displayName: 'User', email: 'user@example.com' };
    const submitReset = vi.fn();
    const reset = render(<AdminDialogs controller={controller({ resetUser, submitReset })} />);
    fireEvent.submit(screen.getByRole('dialog'));
    expect(submitReset).toHaveBeenCalled();
    reset.unmount();

    const reusable = { id: 'invite', isReusable: true, email: null };
    const revokeMutation = { isPending: false, error: null, reset: vi.fn(), mutate: vi.fn() };
    const setRevokeInvitation = vi.fn();
    const first = render(
      <AdminDialogs
        controller={controller({ revokeInvitation: reusable, revokeMutation, setRevokeInvitation })}
      />,
    );
    expect(screen.getByText(/reusable invitation link/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(revokeMutation.reset).toHaveBeenCalled();
    expect(setRevokeInvitation).toHaveBeenCalledWith(null);
    first.unmount();

    render(
      <AdminDialogs
        controller={controller({
          revokeInvitation: { id: 'personal', isReusable: false, email: 'person@example.com' },
          revokeMutation,
        })}
      />,
    );
    expect(screen.getByText('person@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    expect(revokeMutation.mutate).toHaveBeenCalledWith('personal');
  });
});
