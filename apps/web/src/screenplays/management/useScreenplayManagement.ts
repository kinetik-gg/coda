import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import type {
  AvailableScreenplayUser,
  ManagedScreenplay,
  ManagedScreenplayMembership,
} from './types';

export function useScreenplayManagement({
  screenplayId,
  screenplay,
  onDeleted,
}: {
  screenplayId: string;
  screenplay: ManagedScreenplay;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const permissions = screenplay.currentMembership.permissions;
  const canManageSettings = permissions.includes('manage_screenplay_settings');
  const canInvite = permissions.includes('invite_members');
  const canManageMemberRoles = permissions.includes('manage_member_roles');
  const currentRole = screenplay.roles.find(
    (role) => role.id === screenplay.currentMembership.roleId,
  );
  const isOwner = currentRole?.isOwner ?? false;
  const assignableRoles = useMemo(
    () => screenplay.roles.filter((role) => !role.isOwner),
    [screenplay.roles],
  );

  const [title, setTitle] = useState(screenplay.title);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addRoleId, setAddRoleId] = useState('');
  const [transferMembershipId, setTransferMembershipId] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<ManagedScreenplayMembership>();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState<string>();

  useEffect(() => {
    setTitle(screenplay.title);
    const firstRole = assignableRoles[0]?.id ?? '';
    setInviteRoleId((current) =>
      assignableRoles.some((role) => role.id === current) ? current : firstRole,
    );
    setAddRoleId((current) =>
      assignableRoles.some((role) => role.id === current) ? current : firstRole,
    );
  }, [assignableRoles, screenplay.title]);

  const availableUsers = useQuery({
    queryKey: ['screenplay-available-users', screenplayId],
    queryFn: () =>
      api<AvailableScreenplayUser[]>(`/api/v1/screenplays/${screenplayId}/available-users`),
    enabled: canInvite,
  });

  useEffect(() => {
    if (!availableUsers.data?.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(availableUsers.data?.[0]?.id ?? '');
    }
  }, [availableUsers.data, selectedUserId]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['screenplay-management', screenplayId] }),
      queryClient.invalidateQueries({ queryKey: ['screenplay', screenplayId] }),
      queryClient.invalidateQueries({ queryKey: ['screenplays'] }),
      queryClient.invalidateQueries({ queryKey: ['screenplay-available-users', screenplayId] }),
    ]);
  };

  const updateTitle = useMutation({
    mutationFn: () =>
      api(`/api/v1/screenplays/${screenplayId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), version: screenplay.version }),
      }),
    onSuccess: invalidate,
  });
  const invite = useMutation({
    mutationFn: () =>
      api<{ invitationUrl: string }>(`/api/v1/screenplays/${screenplayId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), roleId: inviteRoleId }),
      }),
    onSuccess: async (result) => {
      setInviteEmail('');
      setInvitationUrl(result.invitationUrl);
      await invalidate();
    },
  });
  const addMember = useMutation({
    mutationFn: () =>
      api(`/api/v1/screenplays/${screenplayId}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, roleId: addRoleId }),
      }),
    onSuccess: invalidate,
  });
  const changeMemberRole = useMutation({
    mutationFn: (input: { membershipId: string; roleId: string; version: number }) =>
      api(`/api/v1/screenplays/${screenplayId}/memberships/${input.membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId: input.roleId, version: input.version }),
      }),
    onSuccess: invalidate,
  });
  const removeMember = useMutation({
    mutationFn: (membership: ManagedScreenplayMembership) =>
      api(`/api/v1/screenplays/${screenplayId}/memberships/${membership.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: membership.version }),
      }),
    onSuccess: async () => {
      setMemberToRemove(undefined);
      await invalidate();
    },
  });
  const transferOwnership = useMutation({
    mutationFn: () =>
      api(`/api/v1/screenplays/${screenplayId}/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({
          newOwnerMembershipId: transferMembershipId,
          version: screenplay.version,
        }),
      }),
    onSuccess: async () => {
      setTransferMembershipId('');
      await invalidate();
    },
  });
  const trashScreenplay = useMutation({
    mutationFn: () => api(`/api/v1/screenplays/${screenplayId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['screenplays'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-screenplays'] });
      onDeleted();
    },
  });

  const titleDirty = title.trim() !== screenplay.title && title.trim().length > 0;
  const transferCandidates = useMemo(
    () => screenplay.memberships.filter((membership) => !membership.role?.isOwner),
    [screenplay.memberships],
  );

  return {
    screenplayId,
    screenplay,
    permissions,
    canManageSettings,
    canInvite,
    canManageMemberRoles,
    isOwner,
    assignableRoles,
    transferCandidates,
    title,
    setTitle,
    titleDirty,
    inviteEmail,
    setInviteEmail,
    inviteRoleId,
    setInviteRoleId,
    selectedUserId,
    setSelectedUserId,
    addRoleId,
    setAddRoleId,
    transferMembershipId,
    setTransferMembershipId,
    memberToRemove,
    setMemberToRemove,
    confirmTrash,
    setConfirmTrash,
    invitationUrl,
    setInvitationUrl,
    availableUsers,
    updateTitle,
    invite,
    addMember,
    changeMemberRole,
    removeMember,
    transferOwnership,
    trashScreenplay,
  };
}

export type ScreenplayManagementController = ReturnType<typeof useScreenplayManagement>;
