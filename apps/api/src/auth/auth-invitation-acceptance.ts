import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { hashToken } from '../common/crypto';
import type {
  AcceptInvitationInput,
  AcceptInvitationUserInput,
  InvitationAcceptanceDeps,
} from './auth-invitation-user-preparation';
import {
  createInvitedUser,
  invalidInvitation,
  isUniqueConstraintError,
  prepareInvitedUser,
} from './auth-invitation-user-preparation';
import { assertInvitationProjectRoleAvailable } from '../projects/project-role-lifecycle';
import { assertInvitationScreenplayRoleAvailable } from '../screenplays/screenplay-role-lifecycle';
import { assertInvitationSpaceRoleAvailable } from '../spaces/space-role-lifecycle';
import { assertInvitationTrackerRoleAvailable } from '../trackers/tracker-role-lifecycle';
import {
  acceptTrackerInvitation,
  assertActiveTrackerInvitation,
  type TrackerInvitation,
} from '../trackers/tracker-invitation-acceptance';

export type {
  AcceptInvitationInput,
  InvitationAcceptanceDeps,
} from './auth-invitation-user-preparation';

interface InvitationActivity {
  resourceType: 'invitation' | 'instance_invitation' | 'bulk_instance_invitation';
  resourceId: string;
  includeRoleMetadata: boolean;
}

interface ProjectInvitation {
  id: string;
  email: string;
  projectId: string;
  roleId: string;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date;
  project: { deletedAt: Date | null } | null;
}

interface ScreenplayInvitation {
  id: string;
  email: string;
  screenplayId: string;
  roleId: string;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

interface SpaceInvitation {
  id: string;
  email: string;
  spaceId: string;
  roleId: string;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date;
  space: { deletedAt: Date | null } | null;
}

interface InstanceInvitation {
  id: string;
  email: string | null;
  projectId: string | null;
  roleId: string | null;
  trackerId: string | null;
  trackerRoleId: string | null;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  isReusable: boolean;
  project: { deletedAt: Date | null } | null;
  tracker: { deletedAt: Date | null } | null;
}

export async function acceptInvitation(
  deps: InvitationAcceptanceDeps,
  input: AcceptInvitationInput,
  currentUserId?: string,
) {
  const tokenHash = hashToken(input.token);
  const projectInvitation = await deps.prisma.projectInvitation.findUnique({
    where: { tokenHash },
    include: { project: { select: { deletedAt: true } } },
  });
  if (projectInvitation) {
    assertActiveProjectInvitation(projectInvitation);
    return acceptProjectInvitation(deps, projectInvitation, input, currentUserId);
  }

  const screenplayInvitation = await deps.prisma.screenplayInvitation.findUnique({
    where: { tokenHash },
  });
  if (screenplayInvitation) {
    assertActiveScreenplayInvitation(screenplayInvitation);
    return acceptScreenplayInvitation(deps, screenplayInvitation, input, currentUserId);
  }

  const spaceInvitation = await deps.prisma.spaceInvitation?.findUnique({
    where: { tokenHash },
    include: { space: { select: { deletedAt: true } } },
  });
  if (spaceInvitation) {
    assertActiveSpaceInvitation(spaceInvitation);
    return acceptSpaceInvitation(deps, spaceInvitation, input, currentUserId);
  }

  const trackerInvitation: TrackerInvitation | null =
    (await deps.prisma.trackerInvitation?.findUnique({ where: { tokenHash } })) ?? null;
  if (trackerInvitation) {
    assertActiveTrackerInvitation(trackerInvitation);
    return acceptTrackerInvitation(deps, trackerInvitation, input, currentUserId);
  }

  const instanceInvitation = await deps.prisma.instanceInvitation.findUnique({
    where: { tokenHash },
    include: {
      project: { select: { deletedAt: true } },
      tracker: { select: { deletedAt: true } },
    },
  });
  assertActiveInstanceInvitation(instanceInvitation);
  if (instanceInvitation.isReusable) {
    return acceptReusableInvitation(deps, instanceInvitation, input, currentUserId);
  }
  if (!instanceInvitation.email) invalidInvitation();
  return acceptSingleInstanceInvitation(
    deps,
    instanceInvitation,
    instanceInvitation.email,
    input,
    currentUserId,
  );
}

function assertActiveProjectInvitation(invitation: ProjectInvitation): void {
  if (
    invitation.status !== 'PENDING' ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date() ||
    invitation.project?.deletedAt
  ) {
    invalidInvitation();
  }
}

function assertActiveInstanceInvitation(
  invitation: InstanceInvitation | null,
): asserts invitation is InstanceInvitation {
  if (
    !invitation ||
    invitation.status !== 'PENDING' ||
    invitation.revokedAt ||
    (invitation.expiresAt && invitation.expiresAt <= new Date()) ||
    invitation.project?.deletedAt ||
    invitation.tracker?.deletedAt
  ) {
    invalidInvitation();
  }
}

async function acceptProjectInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: ProjectInvitation,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(deps.prisma, invitation.email, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await assertInvitationProjectRoleAvailable(
        deps.db,
        tx,
        invitation.projectId,
        invitation.roleId,
      );
      const user = await createInvitedUser(tx, invitation.email, input, prepared);
      const updated = await tx.projectInvitation.updateMany({
        where: {
          id: invitation.id,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: { gt: new Date() },
          project: { deletedAt: null },
        },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
      });
      if (!updated.count) throw new ConflictException('Invitation was already used');
      await grantProjectAccess(tx, invitation.projectId, invitation.roleId, user.id, {
        resourceType: 'invitation',
        resourceId: invitation.id,
        includeRoleMetadata: false,
      });
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('An account already exists for this invitation email');
    }
    throw error;
  }
}

function assertActiveScreenplayInvitation(invitation: ScreenplayInvitation): void {
  if (
    invitation.status !== 'PENDING' ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date()
  ) {
    invalidInvitation();
  }
}

function assertActiveSpaceInvitation(invitation: SpaceInvitation): void {
  if (
    invitation.status !== 'PENDING' ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date() ||
    invitation.space?.deletedAt
  ) {
    invalidInvitation();
  }
}

async function acceptScreenplayInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: ScreenplayInvitation,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(deps.prisma, invitation.email, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await assertInvitationScreenplayRoleAvailable(
        deps.db,
        tx,
        invitation.screenplayId,
        invitation.roleId,
      );
      const user = await createInvitedUser(tx, invitation.email, input, prepared);
      const updated = await tx.screenplayInvitation.updateMany({
        where: {
          id: invitation.id,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
      });
      if (!updated.count) throw new ConflictException('Invitation was already used');
      await tx.screenplayMembership.upsert({
        where: {
          screenplayId_userId: { screenplayId: invitation.screenplayId, userId: user.id },
        },
        create: {
          screenplayId: invitation.screenplayId,
          userId: user.id,
          roleId: invitation.roleId,
        },
        update: {},
      });
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('An account already exists for this invitation email');
    }
    throw error;
  }
}

async function acceptSpaceInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: SpaceInvitation,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(deps.prisma, invitation.email, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await assertInvitationSpaceRoleAvailable(deps.db, tx, invitation.spaceId, invitation.roleId);
      const user = await createInvitedUser(tx, invitation.email, input, prepared);
      const updated = await tx.spaceInvitation.updateMany({
        where: {
          id: invitation.id,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: { gt: new Date() },
          space: { deletedAt: null },
        },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
      });
      if (!updated.count) throw new ConflictException('Invitation was already used');
      await tx.spaceMembership.upsert({
        where: { spaceId_userId: { spaceId: invitation.spaceId, userId: user.id } },
        create: { spaceId: invitation.spaceId, userId: user.id, roleId: invitation.roleId },
        update: {},
      });
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('An account already exists for this invitation email');
    }
    throw error;
  }
}

async function acceptSingleInstanceInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: InstanceInvitation,
  invitedEmail: string,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(deps.prisma, invitedEmail, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await assertInvitationProjectRoleAvailable(
        deps.db,
        tx,
        invitation.projectId,
        invitation.roleId,
      );
      await assertInvitationTrackerRoleAvailable(
        deps.db,
        tx,
        invitation.trackerId,
        invitation.trackerRoleId,
      );
      const user = await createInvitedUser(tx, invitedEmail, input, prepared);
      await claimSingleInstanceInvitation(tx, invitation, user.id);
      await grantOptionalProjectAccess(tx, invitation, user.id, 'instance_invitation');
      await grantOptionalTrackerAccess(tx, invitation, user.id);
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('An account already exists for this invitation email');
    }
    throw error;
  }
}

async function claimSingleInstanceInvitation(
  tx: Prisma.TransactionClient,
  invitation: InstanceInvitation,
  userId: string,
): Promise<void> {
  const updated = await tx.instanceInvitation.updateMany({
    where: {
      id: invitation.id,
      status: 'PENDING',
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { OR: [{ projectId: null }, { project: { deletedAt: null } }] },
        { OR: [{ trackerId: null }, { tracker: { deletedAt: null } }] },
      ],
    },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: userId },
  });
  if (!updated.count) throw new ConflictException('Invitation was already used');
}

async function acceptReusableInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: InstanceInvitation,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  if (!input.email) throw new BadRequestException('Email is required for this invitation');
  const prepared = await prepareInvitedUser(deps.prisma, input.email, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const activeInvitation = await claimReusableInvitation(tx, invitation.id);
      await assertInvitationProjectRoleAvailable(
        deps.db,
        tx,
        activeInvitation.projectId,
        activeInvitation.roleId,
      );
      await assertInvitationTrackerRoleAvailable(
        deps.db,
        tx,
        activeInvitation.trackerId,
        activeInvitation.trackerRoleId,
      );
      const user = await createInvitedUser(tx, input.email!, input, prepared);
      await tx.instanceInvitationRedemption.create({
        data: { invitationId: activeInvitation.id, userId: user.id, email: user.email },
      });
      await grantOptionalProjectAccess(tx, activeInvitation, user.id, 'bulk_instance_invitation');
      await grantOptionalTrackerAccess(tx, activeInvitation, user.id);
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('This account has already used this invitation');
    }
    throw error;
  }
}

async function claimReusableInvitation(tx: Prisma.TransactionClient, invitationId: string) {
  const activeWhere = {
    id: invitationId,
    isReusable: true,
    status: 'PENDING' as const,
    revokedAt: null,
    expiresAt: { gt: new Date() },
    AND: [
      { OR: [{ projectId: null }, { project: { deletedAt: null } }] },
      { OR: [{ trackerId: null }, { tracker: { deletedAt: null } }] },
    ],
  };
  const claimed = await tx.instanceInvitation.updateMany({
    where: activeWhere,
    data: { revokedAt: null },
  });
  if (!claimed.count) invalidInvitation();
  const activeInvitation = await tx.instanceInvitation.findFirst({ where: activeWhere });
  if (!activeInvitation) invalidInvitation();
  return activeInvitation;
}

/**
 * Grants the tracker membership an instance invitation embeds, mirroring
 * {@link grantOptionalProjectAccess} minus the workspace-layout bootstrap and the activity write:
 * trackers have no published default to clone yet, and the tracker activity writer lands with the
 * tracker activity surface. The upsert makes a replayed redemption idempotent.
 */
async function grantOptionalTrackerAccess(
  tx: Prisma.TransactionClient,
  invitation: { trackerId: string | null; trackerRoleId: string | null },
  userId: string,
): Promise<void> {
  if (!invitation.trackerId || !invitation.trackerRoleId) return;
  await tx.trackerMembership.upsert({
    where: { trackerId_userId: { trackerId: invitation.trackerId, userId } },
    create: { trackerId: invitation.trackerId, userId, roleId: invitation.trackerRoleId },
    update: {},
  });
}

async function grantOptionalProjectAccess(
  tx: Prisma.TransactionClient,
  invitation: { id: string; projectId: string | null; roleId: string | null },
  userId: string,
  resourceType: InvitationActivity['resourceType'],
): Promise<void> {
  if (!invitation.projectId || !invitation.roleId) return;
  await grantProjectAccess(tx, invitation.projectId, invitation.roleId, userId, {
    resourceType,
    resourceId: invitation.id,
    includeRoleMetadata: true,
  });
}

async function grantProjectAccess(
  tx: Prisma.TransactionClient,
  projectId: string,
  roleId: string,
  userId: string,
  activity: InvitationActivity,
): Promise<void> {
  const membership = await tx.projectMembership.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, roleId },
    update: {},
  });
  const publishedDefault = await tx.projectWorkspaceDefault.findUniqueOrThrow({
    where: { projectId },
  });
  await tx.projectMembershipWorkspaceLayout.upsert({
    where: { membershipId: membership.id },
    create: {
      membershipId: membership.id,
      layout: publishedDefault.layout as unknown as Prisma.InputJsonValue,
      schemaVersion: publishedDefault.schemaVersion,
      basedOnDefaultRevision: publishedDefault.revision,
    },
    update: {},
  });
  await tx.projectUserWorkspaceLayout.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: {
      projectId,
      userId,
      layout: publishedDefault.layout as unknown as Prisma.InputJsonValue,
      schemaVersion: publishedDefault.schemaVersion,
      basedOnDefaultRevision: publishedDefault.revision,
    },
    update: {},
  });
  await tx.activityEvent.create({
    data: {
      projectId,
      actorId: userId,
      action: 'ACCEPTED',
      resourceType: activity.resourceType,
      resourceId: activity.resourceId,
      metadata: activity.includeRoleMetadata ? { roleId } : undefined,
    },
  });
}
