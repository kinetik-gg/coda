import type { ManagedScreenplay } from '../management/types';

/** One collaborator row in the inspector's Members section. */
export interface InspectorMember {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
}

function memberName(user: { displayName: string; email: string } | null): string {
  if (!user) return 'Removed user';
  return user.displayName.trim() || user.email;
}

/**
 * Flattens the management payload into inspector member rows, owner first and
 * then alphabetical, so the pane reads the same order every time it is opened.
 */
export function resolveInspectorMembers(management?: ManagedScreenplay): InspectorMember[] {
  if (!management) return [];
  return management.memberships
    .map((membership) => ({
      id: membership.id,
      name: memberName(membership.user),
      role: membership.role?.name ?? 'No role',
      isOwner: membership.role?.isOwner ?? false,
    }))
    .sort((left, right) => {
      if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

/**
 * Names the owner from whatever the caller is allowed to see. The management
 * payload is gated on `manage_screenplay_settings`, so a shared screenplay a
 * member cannot administer resolves to the honest fallbacks rather than an id.
 */
export function resolveScreenplayOwnerLabel({
  ownerUserId,
  sessionUserId,
  management,
}: {
  ownerUserId: string;
  sessionUserId?: string;
  management?: ManagedScreenplay;
}): string {
  const owner = resolveInspectorMembers(management).find((member) => member.isOwner);
  if (owner) return sessionUserId === ownerUserId ? `${owner.name} (you)` : owner.name;
  if (sessionUserId !== undefined && sessionUserId === ownerUserId) return 'You';
  return 'Another member';
}
