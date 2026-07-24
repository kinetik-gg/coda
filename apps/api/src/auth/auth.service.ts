import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from 'argon2';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { createToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  account,
  administratorResetPassword,
  changeAccountPassword,
  optionalProfileValue,
  updateAccountPreferences,
  updateAccountProfile,
} from './auth-account';
import {
  acceptInvitation as acceptInvitationWithToken,
  type AcceptInvitationInput,
} from './auth-invitation-acceptance';
import { backoffLockedUntil, isLoginLocked, loginBackoffPolicy } from './login-backoff';
import { assertPasswordDoesNotContainEmail } from './password-policy';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$YhUj7ZrzKnZZB8mF9j9Glg$imLPxxTnY+r0NRtNWmF2mKESNfdfy8uyDthm4MczDHQ';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async setupStatus() {
    return {
      initialized: (await this.prisma.instanceSettings.count()) > 0,
    };
  }

  async setupOwner(input: {
    displayName: string;
    email: string;
    password: string;
    company?: string | null;
    department?: string | null;
  }) {
    const passwordHash = await hash(input.password, { type: 2 });
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(1122334455)`);
        if ((await tx.instanceSettings.count()) > 0)
          throw new ConflictException('Instance setup is already complete');
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            company: optionalProfileValue(input.company),
            department: optionalProfileValue(input.department),
          },
        });
        await tx.instanceSettings.create({ data: { ownerUserId: user.id } });
        return user;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Email is already in use');
      throw error;
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = Date.now();
    const active = user?.status === 'ACTIVE';
    // A locked account still verifies against its real hash so that its timing and response shape are
    // identical to an ordinary failed login. Never short-circuit before the constant-time verify: that
    // would leak whether an account exists or is currently locked.
    const locked = active && isLoginLocked(user.loginLockedUntil, now);
    const passwordHash = active ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordMatches = await verify(passwordHash, password);
    if (!active || locked || !passwordMatches) {
      if (active && !locked) await this.registerFailedLogin(user.id, user.failedLoginAttempts, now);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    }
    return user;
  }

  private async registerFailedLogin(
    userId: string,
    priorAttempts: number,
    now: number,
  ): Promise<void> {
    const attempts = priorAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        loginLockedUntil: backoffLockedUntil(loginBackoffPolicy(), attempts, now),
      },
    });
  }

  /** Minimal identity for a verified user id, used to shape the post-2FA login response. */
  async userIdentity(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });
  }

  async createSession(userId: string) {
    const token = createToken();
    const csrf = createToken(24);
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86_400_000);
    const session = await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    });
    return { session, token, csrf };
  }

  async logout(sessionId?: string): Promise<void> {
    if (sessionId) await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async invitation(token: string) {
    const tokenHash = hashToken(token);
    const projectInvitation = await this.prisma.projectInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        project: { select: { id: true, name: true, deletedAt: true } },
        role: { select: { id: true, name: true } },
      },
    });
    if (projectInvitation) {
      if (
        projectInvitation.status !== 'PENDING' ||
        projectInvitation.revokedAt ||
        projectInvitation.expiresAt <= new Date() ||
        projectInvitation.project.deletedAt
      ) {
        throw new NotFoundException('Invitation is invalid or expired');
      }
      return {
        kind: 'project' as const,
        email: projectInvitation.email,
        expiresAt: projectInvitation.expiresAt,
        project: { id: projectInvitation.project.id, name: projectInvitation.project.name },
        role: projectInvitation.role,
      };
    }
    const instanceInvitation = await this.prisma.instanceInvitation.findUnique({
      where: { tokenHash },
      include: {
        project: { select: { id: true, name: true, deletedAt: true } },
        role: { select: { id: true, name: true } },
      },
    });
    if (
      !instanceInvitation ||
      instanceInvitation.status !== 'PENDING' ||
      instanceInvitation.revokedAt ||
      (instanceInvitation.expiresAt && instanceInvitation.expiresAt <= new Date()) ||
      instanceInvitation.project?.deletedAt
    ) {
      throw new NotFoundException('Invitation is invalid or expired');
    }
    if (instanceInvitation.isReusable) {
      return {
        kind: 'bulk_instance' as const,
        email: null,
        expiresAt: instanceInvitation.expiresAt,
        project: instanceInvitation.project
          ? { id: instanceInvitation.project.id, name: instanceInvitation.project.name }
          : null,
        role: instanceInvitation.role,
      };
    }
    return {
      kind: 'instance' as const,
      email: instanceInvitation.email,
      expiresAt: instanceInvitation.expiresAt,
      project: instanceInvitation.project
        ? { id: instanceInvitation.project.id, name: instanceInvitation.project.name }
        : null,
      role: instanceInvitation.role,
    };
  }

  async acceptInvitation(input: AcceptInvitationInput, currentUserId?: string) {
    return acceptInvitationWithToken(this.prisma, input, currentUserId);
  }

  async createResetLink(actorId: string, userId: string) {
    const settings = await this.prisma.instanceSettings.findFirst();
    if (settings?.ownerUserId !== actorId)
      throw new ForbiddenException('Only the instance administrator can create reset links');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const token = createToken();
    const now = new Date();
    const reset = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
      );
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      return tx.passwordResetToken.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
      });
    });
    return { reset, token };
  }

  async resetPassword(token: string, password: string) {
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { email: true } } },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || !reset.user)
      throw new NotFoundException('Reset link is invalid or expired');
    assertPasswordDoesNotContainEmail(password, reset.user.email);
    const passwordHash = await hash(password, { type: 2 });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${reset.userId}, 0))`,
      );
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (!consumed.count) throw new NotFoundException('Reset link is invalid or expired');
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash, failedLoginAttempts: 0, loginLockedUntil: null },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.session.deleteMany({ where: { userId: reset.userId } });
    });
    return { reset: true };
  }

  account(userId: string) {
    return account(this.prisma, userId);
  }

  async updateAccountProfile(
    userId: string,
    input: {
      displayName?: string;
      email?: string;
      company?: string | null;
      department?: string | null;
    },
  ) {
    return updateAccountProfile(this.prisma, userId, input);
  }

  updateAccountPreferences(
    userId: string,
    input: {
      theme: string;
      fontSize: string;
      motion: string;
      pdfAppearance: string;
    },
  ) {
    return updateAccountPreferences(this.prisma, userId, input);
  }

  async changeAccountPassword(
    userId: string,
    currentSessionId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ) {
    return changeAccountPassword(
      this.prisma,
      userId,
      currentSessionId,
      currentPassword,
      newPassword,
    );
  }

  async administratorResetPassword(actorId: string, userId: string, password: string) {
    return administratorResetPassword(this.prisma, actorId, userId, password);
  }
}
