import type { ScreenplayPermission } from '@coda/contracts';

/** A member/inviter identity, hydrated by the API from the plain user id columns. */
export interface ManagedScreenplayUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

export interface ManagedScreenplayRole {
  id: string;
  name: string;
  isOwner: boolean;
  position: number;
  description?: string | null;
  permissions: { permission: ScreenplayPermission }[];
  _count: { memberships: number };
}

export interface ManagedScreenplayMembership {
  id: string;
  version: number;
  createdAt: string;
  role: { id: string; name: string; isOwner: boolean } | null;
  user: ManagedScreenplayUser | null;
}

export interface ManagedScreenplayInvitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  role: { id: string; name: string } | null;
  inviter: { id: string; displayName: string } | null;
}

/** The screenplay management payload returned by `GET /screenplays/:id/management`. */
export interface ManagedScreenplay {
  id: string;
  title: string;
  filename: string;
  ownerUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  roles: ManagedScreenplayRole[];
  memberships: ManagedScreenplayMembership[];
  invitations: ManagedScreenplayInvitation[];
  currentMembership: {
    id: string;
    roleId: string;
    permissions: ScreenplayPermission[];
  };
}

export interface AvailableScreenplayUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

export type ScreenplayManagementSection = 'members' | 'roles' | 'settings';
