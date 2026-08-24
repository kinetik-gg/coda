import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { hash } from 'argon2';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { ensurePersonalDefaultSpace } from '../spaces/personal-default-space';
import { optionalProfileValue } from './auth-account';

/**
 * The account-resolution half of public invitation acceptance, shared by every invitation family
 * (project, screenplay, space, tracker, instance): resolve the invited account, enforce the
 * email/signed-in match, hash a password for a brand-new account, and create that account with its
 * personal Default Space inside the caller's transaction.
 *
 * This lives in its own leaf module rather than beside the acceptance dispatcher so resource
 * modules (e.g. the tracker acceptance) can reuse it without importing the dispatcher — an import
 * back into `auth/` from there would close a cycle `quality:cycles` fails on. The acceptance
 * dependency bundle and input shape live here too for the same reason.
 */
export interface InvitationAcceptanceDeps {
  prisma: PrismaService;
  db: DatabaseCapabilities;
}

export interface AcceptInvitationUserInput {
  email?: string;
  displayName?: string;
  password?: string;
  company?: string | null;
  department?: string | null;
}

export interface AcceptInvitationInput extends AcceptInvitationUserInput {
  token: string;
}

/** Answers why a token that resolved to no active invitation is unusable — always the same 404. */
export function invalidInvitation(): never {
  throw new NotFoundException('Invitation is invalid or expired');
}

export interface PreparedInvitedUser {
  existingUser: User | null;
  passwordHash: string | null;
}

export async function prepareInvitedUser(
  prisma: PrismaService,
  invitedEmail: string,
  input: AcceptInvitationUserInput,
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

export async function createInvitedUser(
  tx: Prisma.TransactionClient,
  invitedEmail: string,
  input: AcceptInvitationUserInput,
  prepared: PreparedInvitedUser,
): Promise<User> {
  if (prepared.existingUser) return prepared.existingUser;
  const user = await tx.user.create({
    data: {
      email: invitedEmail,
      displayName: input.displayName!,
      passwordHash: prepared.passwordHash!,
      company: optionalProfileValue(input.company),
      department: optionalProfileValue(input.department),
    },
  });
  await ensurePersonalDefaultSpace(tx, user.id);
  return user;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
