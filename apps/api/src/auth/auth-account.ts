import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash, verify } from 'argon2';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';

interface ProfileInput {
  displayName?: string;
  email?: string;
  company?: string | null;
  department?: string | null;
}

interface PreferencesInput {
  theme: string;
  fontSize: string;
  motion: string;
  pdfAppearance: string;
}

const accountSelection = {
  id: true,
  email: true,
  displayName: true,
  company: true,
  department: true,
  theme: true,
  fontSize: true,
  motionPreference: true,
  pdfAppearance: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function account(prisma: PrismaService, userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: accountSelection });
}

export async function updateAccountProfile(
  prisma: PrismaService,
  userId: string,
  input: ProfileInput,
) {
  try {
    return await prisma.user.update({
      where: { id: userId, status: 'ACTIVE' },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.company !== undefined ? { company: optionalProfileValue(input.company) } : {}),
        ...(input.department !== undefined
          ? { department: optionalProfileValue(input.department) }
          : {}),
      },
      select: accountSelection,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Email is already in use');
    }
    throw error;
  }
}

export function updateAccountPreferences(
  prisma: PrismaService,
  userId: string,
  input: PreferencesInput,
) {
  return prisma.user.update({
    where: { id: userId, status: 'ACTIVE' },
    data: {
      theme: input.theme,
      fontSize: input.fontSize,
      motionPreference: input.motion,
      pdfAppearance: input.pdfAppearance,
    },
    select: {
      theme: true,
      fontSize: true,
      motionPreference: true,
      pdfAppearance: true,
    },
  });
}

export async function changeAccountPassword(
  deps: { prisma: PrismaService; db: DatabaseCapabilities },
  userId: string,
  currentSessionId: string | undefined,
  currentPassword: string,
  newPassword: string,
) {
  const { prisma, db } = deps;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verify(user.passwordHash, currentPassword))) {
    throw new UnauthorizedException('Current password is incorrect');
  }
  const passwordHash = await hash(newPassword, { type: 2 });
  const revoked = await prisma.$transaction(async (tx) => {
    await db.acquireTransactionLock(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    const sessions = await tx.session.deleteMany({
      where: {
        userId,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return sessions;
  });
  return { changed: true, sessionsRevoked: revoked.count };
}

export async function administratorResetPassword(
  deps: { prisma: PrismaService; db: DatabaseCapabilities },
  actorId: string,
  userId: string,
  password: string,
) {
  const { prisma, db } = deps;
  const settings = await prisma.instanceSettings.findFirst({ select: { ownerUserId: true } });
  if (settings?.ownerUserId !== actorId) {
    throw new ForbiddenException('Only the instance administrator may reset user passwords');
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundException('User not found');
  const passwordHash = await hash(password, { type: 2 });
  const revoked = await prisma.$transaction(async (tx) => {
    await db.acquireTransactionLock(tx, userId);
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, loginLockedUntil: null },
    });
    const sessions = await tx.session.deleteMany({ where: { userId } });
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return sessions;
  });
  return { reset: true, sessionsRevoked: revoked.count };
}

export function optionalProfileValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
