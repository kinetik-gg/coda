import type { PrismaService } from '../prisma/prisma.service';
import { spaceResourceRegistry } from '../spaces/space-resource-registry';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * Tracker room naming and the two authorization resolutions the realtime layer needs for it —
 * join (`canJoinTrackerRoom`) and authorized invalidation fanout (`authorizedTrackerMemberIds`).
 * Both express the same rule the REST choke point enforces: a caller reaches a tracker through an
 * active direct `TrackerMembership`, or through an active Space-tier whose grant includes
 * `read_tracker`, and never once the tracker is trashed. They live beside the gateway rather than
 * in it because the gateway sits at its size budget and this is pure resolution logic over Prisma.
 *
 * `SpaceResourcesService` is instantiated without a request auth context on purpose: sockets are
 * authenticated by session at handshake, not by request-scoped credentials, and API keys are never
 * Space members anyway.
 */

export function trackerRoom(trackerId: string): string {
  return `tracker:${trackerId}`;
}

/** Whether an already-resolved Space membership's tier carries the tracker read grant. */
function grantsTrackerRead(
  membership: Awaited<ReturnType<SpaceResourcesService['resolveActiveMembership']>>,
): boolean {
  if (!membership) return false;
  return spaceResourceRegistry.tracker
    .tierPermissions(membership.role.resourceTier)
    .includes('read_tracker');
}

/**
 * Whether `userId` may enter `tracker:<trackerId>`: an active direct membership, else active
 * Space-tier reach granting `read_tracker`, on a tracker that is not soft-deleted.
 */
export async function canJoinTrackerRoom(
  prisma: PrismaService,
  userId: string,
  trackerId: string,
): Promise<boolean> {
  const [membership, tracker] = await Promise.all([
    prisma.trackerMembership.findUnique({
      where: { trackerId_userId: { trackerId, userId } },
      select: { role: { select: { archivedAt: true } } },
    }),
    prisma.tracker.findUnique({ where: { id: trackerId }, select: { deletedAt: true } }),
  ]);
  if (!tracker || tracker.deletedAt) return false;
  if (membership && !membership.role.archivedAt) return true;
  const resources = new SpaceResourcesService(prisma);
  return grantsTrackerRead(await resources.resolveActiveMembership(userId, 'tracker', trackerId));
}

/**
 * The subset of `userIds` entitled to receive invalidations for this tracker: batched direct
 * memberships first, then per-user Space-tier projection (the same resolution the list and the
 * permission choke point use, including the unmapped-resource personal-Default fallback).
 */
export async function authorizedTrackerMemberIds(
  prisma: PrismaService,
  trackerId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const authorized = new Set<string>();
  if (!userIds.length) return authorized;
  const direct = await prisma.trackerMembership.findMany({
    where: { trackerId, userId: { in: [...userIds] }, role: { archivedAt: null } },
    select: { userId: true },
  });
  for (const row of direct) authorized.add(row.userId);
  const pending = userIds.filter((userId) => !authorized.has(userId));
  if (!pending.length) return authorized;
  const resources = new SpaceResourcesService(prisma);
  const projected = await Promise.all(
    pending.map(async (userId) => {
      const membership = await resources.resolveActiveMembership(userId, 'tracker', trackerId);
      return grantsTrackerRead(membership) ? userId : null;
    }),
  );
  for (const userId of projected) if (userId) authorized.add(userId);
  return authorized;
}
