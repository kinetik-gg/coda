import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@coda/contracts';
import { api } from '../api';
import type { AvailableUser, ManagedMembership, ManagedProject, ManagedRole } from './types';

export function useOverviewController({
  projectId,
  project,
  permissions,
}: {
  projectId: string;
  project: ManagedProject;
  permissions: Permission[];
}) {
  const queryClient = useQueryClient();
  const canManageProject = permissions.includes('manage_project_settings');
  const canInviteMembers = permissions.includes('invite_members');
  const canManageMemberRoles = permissions.includes('manage_member_roles');
  const canManageRoles = permissions.includes('manage_roles');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<ManagedMembership>();
  const [roleToArchive, setRoleToArchive] = useState<ManagedRole>();
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState<Permission[]>(['read_project']);
  const assignableRoles = useMemo(
    () => project.roles.filter((role) => !role.isOwner),
    [project.roles],
  );

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setSelectedRoleId((current) => {
      if (project.roles.some((role) => role.id === current && !role.isOwner)) return current;
      return project.roles.find((role) => !role.isOwner)?.id ?? '';
    });
  }, [project]);

  const availableUsers = useQuery({
    queryKey: ['project-available-users', projectId],
    queryFn: () => api<AvailableUser[]>(`/api/v1/projects/${projectId}/available-users`),
    enabled: canInviteMembers,
  });

  useEffect(() => {
    if (!availableUsers.data?.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(availableUsers.data?.[0]?.id ?? '');
    }
  }, [availableUsers.data, selectedUserId]);

  const invalidateProject = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-management', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['project-available-users', projectId] }),
    ]);
  };
  const updateProject = useMutation({
    mutationFn: () =>
      api<ManagedProject>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description: description || null,
          version: project.version,
        }),
      }),
    onSuccess: invalidateProject,
  });
  const addMember = useMutation({
    mutationFn: () =>
      api(`/api/v1/projects/${projectId}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, roleId: selectedRoleId }),
      }),
    onSuccess: invalidateProject,
  });
  const changeMemberRole = useMutation({
    mutationFn: (input: { membershipId: string; roleId: string; version: number }) =>
      api(`/api/v1/projects/${projectId}/memberships/${input.membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId: input.roleId, version: input.version }),
      }),
    onSuccess: invalidateProject,
  });
  const removeMember = useMutation({
    mutationFn: (membership: ManagedMembership) =>
      api(`/api/v1/projects/${projectId}/memberships/${membership.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: membership.version }),
      }),
    onSuccess: async () => {
      setMemberToRemove(undefined);
      await invalidateProject();
    },
  });
  const createRole = useMutation({
    mutationFn: () =>
      api(`/api/v1/projects/${projectId}/roles`, {
        method: 'POST',
        body: JSON.stringify({
          name: newRoleName,
          description: newRoleDescription || null,
          permissions: newRolePermissions,
        }),
      }),
    onSuccess: async () => {
      setNewRoleName('');
      setNewRoleDescription('');
      setNewRolePermissions(['read_project']);
      await invalidateProject();
    },
  });
  const archiveRole = useMutation({
    mutationFn: (role: ManagedRole) =>
      api(`/api/v1/projects/${projectId}/roles/${role.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: role.version ?? 1 }),
      }),
    onSuccess: async () => {
      setRoleToArchive(undefined);
      await invalidateProject();
    },
  });
  const projectDirty = name !== project.name || description !== (project.description ?? '');

  return {
    projectId,
    project,
    permissions,
    canManageProject,
    canInviteMembers,
    canManageMemberRoles,
    canManageRoles,
    name,
    setName,
    description,
    setDescription,
    selectedUserId,
    setSelectedUserId,
    selectedRoleId,
    setSelectedRoleId,
    memberToRemove,
    setMemberToRemove,
    roleToArchive,
    setRoleToArchive,
    newRoleName,
    setNewRoleName,
    newRoleDescription,
    setNewRoleDescription,
    newRolePermissions,
    setNewRolePermissions,
    assignableRoles,
    availableUsers,
    updateProject,
    addMember,
    changeMemberRole,
    removeMember,
    createRole,
    archiveRole,
    projectDirty,
  };
}

export type OverviewController = ReturnType<typeof useOverviewController>;
