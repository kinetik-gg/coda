import type { ManagedMembership, ManagedProject } from '../../project-management/types';

/** One collaborator row in the breakdown properties's Members section. */
export interface BreakdownMember {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
}

/**
 * Flattens the breakdown management payload into properties member rows.
 *
 * The analogue of `screenplays/properties/screenplay-properties-access.ts`, but breakdowns model
 * ownership on the project rather than on the role, so the owner is resolved by matching the
 * membership's user against `ownerUserId` instead of reading an `isOwner` flag off the role.
 */
export function resolveBreakdownMembers(management?: ManagedProject): BreakdownMember[] {
  if (!management) return [];
  return management.memberships
    .map((membership: ManagedMembership) => ({
      id: membership.id,
      name: membership.user.displayName.trim() || membership.user.email,
      role: membership.role.name,
      isOwner: membership.user.id === management.ownerUserId,
    }))
    .sort((left, right) => {
      if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

/**
 * Names the owner from whatever the caller is allowed to see. The management payload is permission
 * gated, so a breakdown shared with a member who cannot administer it resolves to the honest
 * fallbacks rather than leaking an identifier.
 */
export function resolveBreakdownOwnerLabel({
  ownerUserId,
  sessionUserId,
  management,
}: {
  ownerUserId: string;
  sessionUserId?: string;
  management?: ManagedProject;
}): string {
  const owner = resolveBreakdownMembers(management).find((member) => member.isOwner);
  if (owner) return sessionUserId === ownerUserId ? `${owner.name} (you)` : owner.name;
  if (sessionUserId !== undefined && sessionUserId === ownerUserId) return 'You';
  return 'Another member';
}
