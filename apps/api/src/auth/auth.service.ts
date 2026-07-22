import {
  BadRequestException,
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

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async setupStatus() {
    return {
      initialized: (await this.prisma.instanceSettings.count()) > 0,
      setupTokenRequired: Boolean(env().SETUP_TOKEN),
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
            company: this.optionalProfileValue(input.company),
            department: this.optionalProfileValue(input.department),
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
    if (!user || user.status !== 'ACTIVE' || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
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
        project: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
      },
    });
    if (projectInvitation) {
      if (projectInvitation.status !== 'PENDING' || projectInvitation.expiresAt <= new Date()) {
        throw new NotFoundException('Invitation is invalid or expired');
      }
      return {
        kind: 'project' as const,
        email: projectInvitation.email,
        expiresAt: projectInvitation.expiresAt,
        project: projectInvitation.project,
        role: projectInvitation.role,
      };
    }
    const instanceInvitation = await this.prisma.instanceInvitation.findUnique({
      where: { tokenHash },
      include: {
        project: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
      },
    });
    if (
      !instanceInvitation ||
      instanceInvitation.status !== 'PENDING' ||
      instanceInvitation.revokedAt ||
      (instanceInvitation.expiresAt && instanceInvitation.expiresAt <= new Date())
    ) {
      throw new NotFoundException('Invitation is invalid or expired');
    }
    if (instanceInvitation.isReusable) {
      return {
        kind: 'bulk_instance' as const,
        email: null,
        expiresAt: instanceInvitation.expiresAt,
        project: instanceInvitation.project,
        role: instanceInvitation.role,
      };
    }
    return {
      kind: 'instance' as const,
      email: instanceInvitation.email,
      expiresAt: instanceInvitation.expiresAt,
      project: instanceInvitation.project,
      role: instanceInvitation.role,
    };
  }

  async acceptInvitation(
    input: {
      token: string;
      email?: string;
      displayName?: string;
      password?: string;
      company?: string | null;
      department?: string | null;
    },
    currentUserId?: string,
  ) {
    const tokenHash = hashToken(input.token);
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { tokenHash },
    });
    if (invitation) {
      if (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) {
        throw new NotFoundException('Invitation is invalid or expired');
      }
      const user = await this.resolveInvitedUser(invitation.email, input, currentUserId);
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.projectInvitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
        });
        if (!updated.count) throw new ConflictException('Invitation was already used');
        const membership = await tx.projectMembership.upsert({
          where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
          create: { projectId: invitation.projectId, userId: user.id, roleId: invitation.roleId },
          update: {},
        });
        const publishedDefault = await tx.projectWorkspaceDefault.findUniqueOrThrow({
          where: { projectId: invitation.projectId },
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
            projectId: invitation.projectId,
            actorId: user.id,
            action: 'ACCEPTED',
            resourceType: 'invitation',
            resourceId: invitation.id,
          },
        });
      });
      return user;
    }

    const instanceInvitation = await this.prisma.instanceInvitation.findUnique({
      where: { tokenHash },
    });
    if (
      !instanceInvitation ||
      instanceInvitation.status !== 'PENDING' ||
      instanceInvitation.revokedAt ||
      (instanceInvitation.expiresAt && instanceInvitation.expiresAt <= new Date())
    ) {
      throw new NotFoundException('Invitation is invalid or expired');
    }
    if (instanceInvitation.isReusable) {
      return this.acceptReusableInvitation(instanceInvitation, input, currentUserId);
    }
    if (!instanceInvitation.email) {
      throw new NotFoundException('Invitation is invalid or expired');
    }
    const invitedEmail = instanceInvitation.email;
    const existingUser = currentUserId
      ? await this.prisma.user.findUnique({ where: { id: currentUserId } })
      : await this.prisma.user.findUnique({ where: { email: invitedEmail } });
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

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (instanceInvitation.projectId && instanceInvitation.roleId) {
          const role = await tx.projectRole.findFirst({
            where: {
              id: instanceInvitation.roleId,
              projectId: instanceInvitation.projectId,
              archivedAt: null,
              isOwner: false,
              project: { deletedAt: null },
            },
            select: { id: true },
          });
          if (!role) {
            throw new ConflictException('The invitation project role is no longer available');
          }
        }

        const user =
          existingUser ??
          (await tx.user.create({
            data: {
              email: invitedEmail,
              displayName: input.displayName!,
              passwordHash: passwordHash!,
              company: this.optionalProfileValue(input.company),
              department: this.optionalProfileValue(input.department),
            },
          }));
        const updated = await tx.instanceInvitation.updateMany({
          where: { id: instanceInvitation.id, status: 'PENDING', revokedAt: null },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
        });
        if (!updated.count) throw new ConflictException('Invitation was already used');

        if (instanceInvitation.projectId && instanceInvitation.roleId) {
          const membership = await tx.projectMembership.upsert({
            where: {
              projectId_userId: { projectId: instanceInvitation.projectId, userId: user.id },
            },
            create: {
              projectId: instanceInvitation.projectId,
              userId: user.id,
              roleId: instanceInvitation.roleId,
            },
            update: {},
          });
          const publishedDefault = await tx.projectWorkspaceDefault.findUniqueOrThrow({
            where: { projectId: instanceInvitation.projectId },
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
              projectId: instanceInvitation.projectId,
              actorId: user.id,
              action: 'ACCEPTED',
              resourceType: 'instance_invitation',
              resourceId: instanceInvitation.id,
              metadata: { roleId: instanceInvitation.roleId },
            },
          });
        }
        return user;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account already exists for this invitation email');
      }
      throw error;
    }
  }

  private async acceptReusableInvitation(
    invitation: {
      id: string;
      email: string | null;
      projectId: string | null;
      roleId: string | null;
      expiresAt: Date | null;
    },
    input: {
      email?: string;
      displayName?: string;
      password?: string;
      company?: string | null;
      department?: string | null;
    },
    currentUserId?: string,
  ) {
    if (!input.email) throw new BadRequestException('Email is required for this invitation');
    const existingUser = currentUserId
      ? await this.prisma.user.findUnique({ where: { id: currentUserId } })
      : await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser && existingUser.email.toLowerCase() !== input.email.toLowerCase()) {
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

    try {
      return await this.prisma.$transaction(async (tx) => {
        const activeInvitation = await tx.instanceInvitation.findFirst({
          where: {
            id: invitation.id,
            isReusable: true,
            status: 'PENDING',
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        if (!activeInvitation) throw new NotFoundException('Invitation is invalid or expired');

        if (activeInvitation.projectId && activeInvitation.roleId) {
          const role = await tx.projectRole.findFirst({
            where: {
              id: activeInvitation.roleId,
              projectId: activeInvitation.projectId,
              archivedAt: null,
              isOwner: false,
              project: { deletedAt: null },
            },
            select: { id: true },
          });
          if (!role) {
            throw new ConflictException('The invitation project role is no longer available');
          }
        }

        const user =
          existingUser ??
          (await tx.user.create({
            data: {
              email: input.email!,
              displayName: input.displayName!,
              passwordHash: passwordHash!,
              company: this.optionalProfileValue(input.company),
              department: this.optionalProfileValue(input.department),
            },
          }));
        await tx.instanceInvitationRedemption.create({
          data: { invitationId: activeInvitation.id, userId: user.id, email: user.email },
        });

        if (activeInvitation.projectId && activeInvitation.roleId) {
          const membership = await tx.projectMembership.upsert({
            where: {
              projectId_userId: { projectId: activeInvitation.projectId, userId: user.id },
            },
            create: {
              projectId: activeInvitation.projectId,
              userId: user.id,
              roleId: activeInvitation.roleId,
            },
            update: {},
          });
          const publishedDefault = await tx.projectWorkspaceDefault.findUniqueOrThrow({
            where: { projectId: activeInvitation.projectId },
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
              projectId: activeInvitation.projectId,
              actorId: user.id,
              action: 'ACCEPTED',
              resourceType: 'bulk_instance_invitation',
              resourceId: activeInvitation.id,
              metadata: { roleId: activeInvitation.roleId },
            },
          });
        }
        return user;
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This account has already used this invitation');
      }
      throw error;
    }
  }

  private async resolveInvitedUser(
    email: string,
    input: {
      displayName?: string;
      password?: string;
      company?: string | null;
      department?: string | null;
    },
    currentUserId?: string,
  ) {
    let user = currentUserId
      ? await this.prisma.user.findUnique({ where: { id: currentUserId } })
      : await this.prisma.user.findUnique({ where: { email } });
    if (user && user.email.toLowerCase() !== email.toLowerCase())
      throw new ForbiddenException('Invitation email does not match the signed-in user');
    if (!user) {
      if (!input.displayName || !input.password)
        throw new BadRequestException('Display name and password are required for a new account');
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: input.displayName,
          passwordHash: await hash(input.password, { type: 2 }),
          company: this.optionalProfileValue(input.company),
          department: this.optionalProfileValue(input.department),
        },
      });
    } else if (!currentUserId) {
      throw new UnauthorizedException('Sign in before accepting this invitation');
    }
    return user;
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
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date())
      throw new NotFoundException('Reset link is invalid or expired');
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
        data: { passwordHash },
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
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
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
      },
    });
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
    try {
      return await this.prisma.user.update({
        where: { id: userId, status: 'ACTIVE' },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.company !== undefined
            ? { company: this.optionalProfileValue(input.company) }
            : {}),
          ...(input.department !== undefined
            ? { department: this.optionalProfileValue(input.department) }
            : {}),
        },
        select: {
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
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email is already in use');
      }
      throw error;
    }
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
    return this.prisma.user.update({
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

  async changeAccountPassword(
    userId: string,
    currentSessionId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hash(newPassword, { type: 2 });
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
      );
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

  async administratorResetPassword(actorId: string, userId: string, password: string) {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    if (settings?.ownerUserId !== actorId) {
      throw new ForbiddenException('Only the instance administrator may reset user passwords');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');
    const passwordHash = await hash(password, { type: 2 });
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
      );
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      const sessions = await tx.session.deleteMany({ where: { userId } });
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return sessions;
    });
    return { reset: true, sessionsRevoked: revoked.count };
  }

  private optionalProfileValue(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
