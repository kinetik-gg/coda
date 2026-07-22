import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { hash } from 'argon2';
import { hashToken } from '../common/crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { assertInvitationProjectRoleAvailable } from '../projects/project-role-lifecycle';
import { optionalProfileValue } from './auth-account';

export interface AcceptInvitationInput {
  token: string;
  email?: string;
  displayName?: string;
  password?: string;
  company?: string | null;
  department?: string | null;
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

interface InstanceInvitation {
  id: string;
  email: string | null;
  projectId: string | null;
  roleId: string | null;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  isReusable: boolean;
  project: { deletedAt: Date | null } | null;
}

interface PreparedInvitedUser {
  existingUser: User | null;
  passwordHash: string | null;
}

interface InvitationActivity {
  resourceType: 'invitation' | 'instance_invitation' | 'bulk_instance_invitation';
  resourceId: string;
  includeRoleMetadata: boolean;
}

export async function acceptInvitation(
  prisma: PrismaService,
  input: AcceptInvitationInput,
  currentUserId?: string,
) {
  const tokenHash = hashToken(input.token);
  const projectInvitation = await prisma.projectInvitation.findUnique({
    where: { tokenHash },
    include: { project: { select: { deletedAt: true } } },
  });
  if (projectInvitation) {
    assertActiveProjectInvitation(projectInvitation);
    return acceptProjectInvitation(prisma, projectInvitation, input, currentUserId);
  }

  const instanceInvitation = await prisma.instanceInvitation.findUnique({
    where: { tokenHash },
    include: { project: { select: { deletedAt: true } } },
  });
  assertActiveInstanceInvitation(instanceInvitation);
  if (instanceInvitation.isReusable) {
    return acceptReusableInvitation(prisma, instanceInvitation, input, currentUserId);
  }
  if (!instanceInvitation.email) invalidInvitation();
  return acceptSingleInstanceInvitation(
    prisma,
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
    invitation.project?.deletedAt
  ) {
    invalidInvitation();
  }
}

function invalidInvitation(): never {
  throw new NotFoundException('Invitation is invalid or expired');
}

async function prepareInvitedUser(
  prisma: PrismaService,
  invitedEmail: string,
  input: AcceptInvitationInput,
  currentUserId?: string,
): Promise<PreparedInvitedUser> {
  const existingUser = currentUserId
    ? await prisma.user.findUnique({ where: { id: currentUserId } })
    : await prisma.user.findUnique({ where: { email: invitedEmail } });
  if (existingUser && existingUser.email.toLowerCase() !== invitedEmail.toLowerCase()) {
    throw new ForbiddenException('Invitation email does not match the signed-in user');
  }
  if (existingUser && !currentUserId) {
    throw new UnauthorizedException('Sign in before accepting this invitation');
  }
  if (!existingUser && (!input.displayName || !input.password)) {
    throw new BadRequestException('Display name and password are required for a new account');
  }
  const passwordHash =
    !existingUser && input.password ? await hash(input.password, { type: 2 }) : null;
  return { existingUser, passwordHash };
}

async function createInvitedUser(
  tx: Prisma.TransactionClient,
  invitedEmail: string,
  input: AcceptInvitationInput,
  prepared: PreparedInvitedUser,
): Promise<User> {
  if (prepared.existingUser) return prepared.existingUser;
  return tx.user.create({
    data: {
      email: invitedEmail,
      displayName: input.displayName!,
      passwordHash: prepared.passwordHash!,
      company: optionalProfileValue(input.company),
      department: optionalProfileValue(input.department),
    },
  });
}

async function acceptProjectInvitation(
  prisma: PrismaService,
  invitation: ProjectInvitation,
  input: AcceptInvitationInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(prisma, invitation.email, input, currentUserId);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertInvitationProjectRoleAvailable(tx, invitation.projectId, invitation.roleId);
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

async function acceptSingleInstanceInvitation(
  prisma: PrismaService,
  invitation: InstanceInvitation,
  invitedEmail: string,
  input: AcceptInvitationInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(prisma, invitedEmail, input, currentUserId);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertInvitationProjectRoleAvailable(tx, invitation.projectId, invitation.roleId);
      const user = await createInvitedUser(tx, invitedEmail, input, prepared);
      await claimSingleInstanceInvitation(tx, invitation, user.id);
      await grantOptionalProjectAccess(tx, invitation, user.id, 'instance_invitation');
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
      ],
    },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: userId },
  });
  if (!updated.count) throw new ConflictException('Invitation was already used');
}

async function acceptReusableInvitation(
  prisma: PrismaService,
  invitation: InstanceInvitation,
  input: AcceptInvitationInput,
  currentUserId?: string,
) {
  if (!input.email) throw new BadRequestException('Email is required for this invitation');
  const prepared = await prepareInvitedUser(prisma, input.email, input, currentUserId);
  try {
    return await prisma.$transaction(async (tx) => {
      const activeInvitation = await claimReusableInvitation(tx, invitation.id);
      await assertInvitationProjectRoleAvailable(
        tx,
        activeInvitation.projectId,
        activeInvitation.roleId,
      );
      const user = await createInvitedUser(tx, input.email!, input, prepared);
      await tx.instanceInvitationRedemption.create({
        data: { invitationId: activeInvitation.id, userId: user.id, email: user.email },
      });
      await grantOptionalProjectAccess(tx, activeInvitation, user.id, 'bulk_instance_invitation');
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
    OR: [{ projectId: null }, { project: { deletedAt: null } }],
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
