import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrackerPermission } from '@coda/contracts';
import {
  addTrackerMember,
  archiveTrackerRole,
  changeTrackerMemberRole,
  createTrackerRole,
  inviteTrackerMember,
  listTrackerAvailableUsers,
  removeTrackerMember,
  revokeTrackerInvitation,
  transferTrackerOwnership,
} from '../../api';
import type {
  ManagedTracker,
  ManagedTrackerInvitation,
  ManagedTrackerMembership,
  ManagedTrackerRole,
} from './types';

/**
 * Permission-aware controller for one tracker's share modal — the tracker twin of
 * `useScreenplayManagement`, plus the custom-role CRUD the tracker backend ships (#381). Every
 * affordance derives from the management payload's `currentMembership` permissions per the
 * access-control ADR, so a caller can never reach past their own grant.
 */
export function useTrackerManagement({ tracker }: { tracker: ManagedTracker }) {
  const queryClient = useQueryClient();
  const trackerId = tracker.id;
  const permissions = tracker.currentMembership.permissions;
  const canManageSettings = permissions.includes('manage_tracker_settings');
  const canInvite = permissions.includes('invite_members');
  const canManageMemberRoles = permissions.includes('manage_member_roles');
  const canManageRoles = permissions.includes('manage_roles');
  const currentRole = tracker.roles.find((role) => role.id === tracker.currentMembership.roleId);
  const isOwner = currentRole?.isOwner ?? false;
  const assignableRoles = useMemo(
    () => tracker.roles.filter((role) => !role.isOwner),
    [tracker.roles],
  );

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addRoleId, setAddRoleId] = useState('');
  const [transferMembershipId, setTransferMembershipId] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<ManagedTrackerMembership>();
  const [invitationToRevoke, setInvitationToRevoke] = useState<ManagedTrackerInvitation>();
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState<string>();
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<TrackerPermission[]>([]);
  const [roleToArchive, setRoleToArchive] = useState<ManagedTrackerRole>();

  useEffect(() => {
    const firstRole = assignableRoles[0]?.id ?? '';
    setInviteRoleId((current) =>
      assignableRoles.some((role) => role.id === current) ? current : firstRole,
    );
    setAddRoleId((current) =>
      assignableRoles.some((role) => role.id === current) ? current : firstRole,
    );
  }, [assignableRoles]);

  const availableUsers = useQuery({
    queryKey: ['tracker-available-users', trackerId],
    queryFn: () => listTrackerAvailableUsers(trackerId),
    enabled: canInvite,
  });

  useEffect(() => {
    if (!availableUsers.data?.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(availableUsers.data?.[0]?.id ?? '');
    }
  }, [availableUsers.data, selectedUserId]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tracker-management', trackerId] }),
      queryClient.invalidateQueries({ queryKey: ['trackers'] }),
      queryClient.invalidateQueries({ queryKey: ['tracker', trackerId] }),
      queryClient.invalidateQueries({ queryKey: ['tracker-available-users', trackerId] }),
    ]);
  };

  const invite = useMutation({
    mutationFn: () =>
      inviteTrackerMember({ trackerId, email: inviteEmail.trim(), roleId: inviteRoleId }),
    onSuccess: async (result) => {
      setInviteEmail('');
      setInvitationUrl(result.invitationUrl);
      await invalidate();
    },
  });
  const addMember = useMutation({
    mutationFn: () => addTrackerMember({ trackerId, userId: selectedUserId, roleId: addRoleId }),
    onSuccess: invalidate,
  });
  const changeMemberRole = useMutation({
    mutationFn: (input: { membershipId: string; roleId: string; version: number }) =>
      changeTrackerMemberRole({
        trackerId,
        membershipId: input.membershipId,
        roleId: input.roleId,
        version: input.version,
      }),
    onSuccess: invalidate,
  });
  const removeMember = useMutation({
    mutationFn: (membership: ManagedTrackerMembership) =>
      removeTrackerMember({
        trackerId,
        membershipId: membership.id,
        version: membership.version,
      }),
    onSuccess: async () => {
      setMemberToRemove(undefined);
      await invalidate();
    },
  });
  const revokeInvitation = useMutation({
    mutationFn: (invitation: ManagedTrackerInvitation) =>
      revokeTrackerInvitation({ trackerId, invitationId: invitation.id }),
    onSuccess: async () => {
      setInvitationToRevoke(undefined);
      await invalidate();
    },
  });
  const createRole = useMutation({
    mutationFn: () =>
      createTrackerRole({
        trackerId,
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || null,
        permissions: newRolePermissions,
      }),
    onSuccess: async () => {
      setNewRoleName('');
      setNewRoleDescription('');
      setNewRolePermissions([]);
      await invalidate();
    },
  });
  const archiveRole = useMutation({
    mutationFn: (role: ManagedTrackerRole) =>
      archiveTrackerRole({ trackerId, roleId: role.id, version: role.version }),
    onSuccess: async () => {
      setRoleToArchive(undefined);
      await invalidate();
    },
  });
  const transferOwnership = useMutation({
    mutationFn: () =>
      transferTrackerOwnership({
        trackerId,
        newOwnerMembershipId: transferMembershipId,
        version: tracker.version,
      }),
    onSuccess: async () => {
      setTransferMembershipId('');
      await invalidate();
    },
  });

  const transferCandidates = useMemo(
    () => tracker.memberships.filter((membership) => !membership.role?.isOwner),
    [tracker.memberships],
  );

  return {
    trackerId,
    tracker,
    permissions,
    canManageSettings,
    canInvite,
    canManageMemberRoles,
    canManageRoles,
    isOwner,
    assignableRoles,
    transferCandidates,
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
    invitationToRevoke,
    setInvitationToRevoke,
    transferConfirmOpen,
    setTransferConfirmOpen,
    invitationUrl,
    setInvitationUrl,
    newRoleName,
    setNewRoleName,
    newRoleDescription,
    setNewRoleDescription,
    newRolePermissions,
    setNewRolePermissions,
    roleToArchive,
    setRoleToArchive,
    availableUsers,
    invite,
    addMember,
    changeMemberRole,
    removeMember,
    revokeInvitation,
    createRole,
    archiveRole,
    transferOwnership,
  };
}

export type TrackerManagementController = ReturnType<typeof useTrackerManagement>;
