import { useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  AdminPage,
  CreatedInvitation,
  InstanceInvitation,
  InstanceJob,
  InstanceManagementSummary,
  InstanceUser,
  InvitationExpiry,
  InvitationKind,
  InvitationMembership,
  InvitationOptions,
  ManagementListItem,
  Page,
} from './types';
import { errorText } from './utils';

export function useAdminController(activePage: AdminPage) {
  const [search, setSearch] = useState('');
  const [resetUser, setResetUser] = useState<InstanceUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteKind, setInviteKind] = useState<InvitationKind>('email');
  const [inviteExpiry, setInviteExpiry] = useState<InvitationExpiry>('never');
  const [inviteMembership, setInviteMembership] = useState<InvitationMembership>('none');
  const [inviteProjectId, setInviteProjectId] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [createdInvitation, setCreatedInvitation] = useState<CreatedInvitation | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [revokeInvitation, setRevokeInvitation] = useState<InstanceInvitation | null>(null);
  const [disableUser, setDisableUser] = useState<InstanceUser | null>(null);
  const [userStatusFeedback, setUserStatusFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const readiness = useQuery({
    queryKey: ['instance-readiness'],
    queryFn: () => api<Record<string, unknown>>('/api/v1/health/ready'),
    refetchInterval: 10_000,
  });
  const management = useQuery({
    queryKey: ['instance-management'],
    queryFn: () => api<InstanceManagementSummary>('/api/v1/instance/management'),
    retry: false,
    staleTime: 60_000,
  });
  const liveStatus = useQuery({
    queryKey: ['instance-management-status'],
    queryFn: () =>
      api<{ system: InstanceManagementSummary['system']; jobs: InstanceJob[] }>(
        '/api/v1/instance/management/status',
      ),
    enabled: activePage === 'overview',
    refetchInterval: activePage === 'overview' ? 5_000 : false,
  });
  const endpoint = activePage === 'audit' ? 'activities' : activePage;
  const listEnabled = ['projects', 'users', 'storage', 'audit', 'invitations'].includes(activePage);
  const list = useInfiniteQuery({
    queryKey: ['instance-management-list', endpoint, search],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      if (search.trim()) params.set('search', search.trim());
      return api<Page<ManagementListItem>>(`/api/v1/instance/management/${endpoint}?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: listEnabled,
  });
  const listItems = useMemo(
    () => list.data?.pages.flatMap((currentPage) => currentPage.items) ?? [],
    [list.data],
  );
  const jobs = useQuery({
    queryKey: ['instance-management-jobs'],
    queryFn: () => api<InstanceJob[]>('/api/v1/instance/management/jobs'),
    enabled: activePage === 'jobs',
    refetchInterval: activePage === 'jobs' ? 10_000 : false,
  });
  const invitationOptions = useQuery({
    queryKey: ['instance-management-invitation-options'],
    queryFn: () => api<InvitationOptions>('/api/v1/instance/management/invitation-options'),
    enabled: activePage === 'invitations',
    staleTime: 30_000,
  });
  const resetMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api(`/api/v1/instance/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      setResetPassword('');
      setResetConfirmation('');
      setResetUser(null);
    },
  });
  const userStatusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'ACTIVE' | 'DISABLED' }) =>
      api<{
        user: Pick<
          InstanceUser,
          'id' | 'email' | 'displayName' | 'company' | 'department' | 'status' | 'updatedAt'
        >;
        sessionsRevoked: number;
      }>(`/api/v1/instance/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onMutate: () => setUserStatusFeedback(null),
    onSuccess: ({ user, sessionsRevoked }) => {
      setDisableUser(null);
      const sessionLabel = sessionsRevoked === 1 ? 'session was' : 'sessions were';
      setUserStatusFeedback({
        kind: 'success',
        message:
          user.status === 'ACTIVE'
            ? `${user.displayName} is now enabled.`
            : `${user.displayName} is now disabled. ${sessionsRevoked} active ${sessionLabel} revoked.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['instance-management-list', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
    onError: (error) => {
      setUserStatusFeedback({
        kind: 'error',
        message: errorText(error, 'The account status could not be changed.'),
      });
    },
  });
  const inviteMutation = useMutation({
    mutationFn: () =>
      api<{
        email: string | null;
        isReusable?: boolean;
        invitationUrl: string;
        expiresAt: string | null;
      }>(
        inviteKind === 'bulk'
          ? '/api/v1/instance/management/invitations/bulk'
          : '/api/v1/instance/management/invitations',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(inviteKind === 'email' ? { email: inviteEmail.trim() } : {}),
            expiresIn: inviteExpiry,
            ...(inviteMembership === 'project'
              ? { projectId: inviteProjectId, roleId: inviteRoleId }
              : {}),
          }),
        },
      ),
    onSuccess: (invitation) => {
      setCreatedInvitation({
        email: invitation.email,
        isReusable: Boolean(invitation.isReusable),
        url: new URL(invitation.invitationUrl, window.location.origin).toString(),
        expiresAt: invitation.expiresAt,
      });
      setInviteEmail('');
      setInviteMembership('none');
      setInviteProjectId('');
      setInviteRoleId('');
      setCopyState('idle');
      void queryClient.invalidateQueries({ queryKey: ['instance-management-list', 'invitations'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/instance/management/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRevokeInvitation(null);
      void queryClient.invalidateQueries({ queryKey: ['instance-management-list', 'invitations'] });
      void queryClient.invalidateQueries({ queryKey: ['instance-management'] });
    },
  });
  const submitReset = (event: FormEvent) => {
    event.preventDefault();
    resetMutation.reset();
    if (!resetUser || resetPassword.length < 8 || resetPassword !== resetConfirmation) return;
    resetMutation.mutate({ userId: resetUser.id, password: resetPassword });
  };
  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    inviteMutation.reset();
    setCreatedInvitation(null);
    if (inviteKind === 'bulk' && inviteExpiry === 'never') return;
    if (inviteMembership === 'project' && (!inviteProjectId || !inviteRoleId)) return;
    inviteMutation.mutate();
  };
  const changeUserStatus = (user: InstanceUser) => {
    userStatusMutation.reset();
    setUserStatusFeedback(null);
    if (user.status === 'ACTIVE') setDisableUser(user);
    else userStatusMutation.mutate({ userId: user.id, status: 'ACTIVE' });
  };
  const copyInvitation = async () => {
    if (!createdInvitation) return;
    try {
      await navigator.clipboard.writeText(createdInvitation.url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return {
    search,
    setSearch,
    resetUser,
    setResetUser,
    resetPassword,
    setResetPassword,
    resetConfirmation,
    setResetConfirmation,
    inviteEmail,
    setInviteEmail,
    inviteKind,
    setInviteKind,
    inviteExpiry,
    setInviteExpiry,
    inviteMembership,
    setInviteMembership,
    inviteProjectId,
    setInviteProjectId,
    inviteRoleId,
    setInviteRoleId,
    createdInvitation,
    copyState,
    revokeInvitation,
    setRevokeInvitation,
    disableUser,
    setDisableUser,
    userStatusFeedback,
    setUserStatusFeedback,
    readiness,
    management,
    liveStatus,
    listEnabled,
    list,
    listItems,
    jobs,
    invitationOptions,
    resetMutation,
    userStatusMutation,
    inviteMutation,
    revokeMutation,
    submitReset,
    submitInvite,
    changeUserStatus,
    copyInvitation,
  };
}

export type AdminController = ReturnType<typeof useAdminController>;
