import type { TrackerPermission } from '@coda/contracts';

/** A member/inviter identity, hydrated by the API from the plain user id columns. */
export interface ManagedTrackerUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

export interface ManagedTrackerRole {
  id: string;
  name: string;
  isOwner: boolean;
  position: number;
  version: number;
  description?: string | null;
  permissions: { permission: TrackerPermission }[];
  _count: { memberships: number };
}

export interface ManagedTrackerMembership {
  id: string;
  version: number;
  createdAt: string;
  role: { id: string; name: string; isOwner: boolean } | null;
  user: ManagedTrackerUser | null;
}

export interface ManagedTrackerInvitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  role: { id: string; name: string } | null;
  inviter: { id: string; displayName: string } | null;
}

/** The tracker management payload returned by `GET /trackers/:id/management`. */
export interface ManagedTracker {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  roles: ManagedTrackerRole[];
  memberships: ManagedTrackerMembership[];
  invitations: ManagedTrackerInvitation[];
  currentMembership: {
    id: string;
    roleId: string;
    permissions: TrackerPermission[];
  };
}

export interface AvailableTrackerUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}
