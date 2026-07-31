import type { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_SPACE_ID } from './space-constants';

/**
 * Who governs the Default Space, given that nobody is ever a member of it.
 *
 * The Default Space is created by the Spaces migration with **zero `space_memberships` rows**, and
 * that emptiness is load-bearing: seeding one would hand its holder every resource on the instance
 * at once, so the upgrade would silently widen access on every existing install. Nothing in the
 * product adds one either — every path that grants a Space membership itself requires a Space
 * membership first, so Default's emptiness is self-enforcing.
 *
 * The consequence was that `SpacesService.management` — which resolves through the membership
 * choke point — answered `404` to literally everyone, on every instance, fresh or upgraded (#334).
 * The Space that always exists was the one Space whose settings nobody could open.
 *
 * The rule this module implements: **the Default Space is owner-governed rather than
 * membership-governed.** Its authority is the instance administrator
 * (`instance_settings.owner_user_id`) or, when set, the Space's own `spaces.owner_user_id` — which
 * the migration copies from that same instance administrator. Both are checked because they can
 * legitimately disagree: on a *fresh* install the migration runs before any user exists, so
 * `spaces.owner_user_id` is `NULL` and only the instance administrator identifies anyone at all.
 *
 * This is the behaviour `docs/architecture.md` already described — "`spaces.owner_user_id` is
 * settings authority, not an access grant" — which had never been implemented. It is also the same
 * shape as the exemptions `SpaceResourceMovesService.assertMoveAuthorized` and
 * `SpaceResourceCreationService.authorizeTarget` already carry for Default (#266, #271): Default is
 * special-cased in the asserting path rather than given members.
 *
 * It grants nobody new *resource* access. The authority is one person who already administers the
 * whole instance, and the Default Space's own guards are unchanged — it still cannot be deleted or
 * have its ownership transferred. Adding a member to Default remains a deliberate, confirmed act by
 * that administrator, never something a migration or this resolver does.
 */
export type DefaultSpaceAuthority = NonNullable<
  Awaited<ReturnType<typeof resolveDefaultSpaceAuthority>>
>;

type AuthorityPrisma = Pick<PrismaService, 'space' | 'spaceRole' | 'instanceSettings'>;

/**
 * Resolves the caller's standing in the Default Space when they hold no membership row, shaped like
 * the membership Prisma would have returned so every caller downstream reads it unchanged. `id` is
 * `null` precisely because no row exists: a synthetic identifier would be echoed back into
 * membership mutations that could never match it. Returns `null` when the caller is not the
 * authority, and also when the Default Space is absent or soft-deleted — a state the product
 * prevents (`SpacesService.remove` refuses to delete it) and which carries no standing either way.
 */
export async function resolveDefaultSpaceAuthority(prisma: AuthorityPrisma, userId: string) {
  const [space, instance] = await Promise.all([
    prisma.space.findFirst({ where: { id: DEFAULT_SPACE_ID, deletedAt: null } }),
    prisma.instanceSettings.findFirst({ select: { ownerUserId: true } }),
  ]);
  if (!space) return null;
  if (space.ownerUserId !== userId && instance?.ownerUserId !== userId) return null;
  const role = await prisma.spaceRole.findFirst({
    where: { spaceId: DEFAULT_SPACE_ID, isOwner: true, archivedAt: null },
    include: { permissions: true },
  });
  if (!role) return null;
  return {
    id: null,
    spaceId: DEFAULT_SPACE_ID,
    userId,
    roleId: role.id,
    version: space.version,
    createdAt: space.createdAt,
    role,
    space,
  };
}
