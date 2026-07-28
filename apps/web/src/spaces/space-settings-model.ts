import { useQueryClient } from '@tanstack/react-query';
import type { ResourceTier, SpacePermission } from '@coda/contracts';

export const EXPOSURE_CONFIRMATION_THRESHOLD = 10;

export interface SpaceRole {
  id: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  version: number;
  resourceTier: ResourceTier;
  permissions: Array<{ permission: SpacePermission }>;
  _count: { memberships: number };
}

export interface SpaceMembership {
  id: string;
  version: number;
  user: { id: string; displayName: string; email: string } | null;
  role: SpaceRole;
}

export interface ManagedSpace {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string | null;
  isDefault: boolean;
  version: number;
  roles: SpaceRole[];
  memberships: SpaceMembership[];
  invitations: Array<{
    id: string;
    email: string;
    expiresAt: string;
    role: { id: string; name: string };
    inviter: { displayName: string } | null;
  }>;
  currentMembership: { id: string; roleId: string; permissions: SpacePermission[] } | null;
  _count: { resources: number };
}

export interface AvailableUser {
  id: string;
  displayName: string;
  email: string;
}

export const permissionLabels: Record<SpacePermission, string> = {
  read_space: 'View Space',
  manage_space_settings: 'Manage settings',
  invite_members: 'Invite members',
  manage_member_roles: 'Manage member roles',
  manage_roles: 'Manage roles',
  create_resources: 'Create resources',
  move_resources: 'Move resources',
  delete_space: 'Delete Space',
};

export function spacePermission(space: ManagedSpace, permission: SpacePermission): boolean {
  return space.currentMembership?.permissions.includes(permission) === true;
}

export function useSpaceInvalidation(spaceId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['space-management', spaceId] }),
      queryClient.invalidateQueries({ queryKey: ['space-available-users', spaceId] }),
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    ]);
  };
}
