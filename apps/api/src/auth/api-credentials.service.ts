import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { permissionSchema, type CreateApiCredential } from '@coda/contracts';
import { ApiCredentialKind, type Prisma } from '@prisma/client';
import { createToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import type { AuthenticatedCredential, CredentialAudience } from './request-auth-context';

const tokenPrefixes: Record<ApiCredentialKind, string> = {
  API_KEY: 'coda_api',
  MCP_TOKEN: 'coda_mcp',
};

const publicCredentialSelect = {
  id: true,
  projectId: true,
  userId: true,
  kind: true,
  name: true,
  tokenPrefix: true,
  tokenLastFour: true,
  permissions: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ApiCredentialSelect;

@Injectable()
export class ApiCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectPermissions: PermissionService,
  ) {}

  async list(userId: string) {
    return this.prisma.apiCredential.findMany({
      where: { userId },
      select: {
        ...publicCredentialSelect,
        project: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, input: CreateApiCredential) {
    const membership = await this.projectPermissions.membership(userId, input.projectId);
    const granted = new Set(
      membership.role.permissions
        .map((entry) => permissionSchema.safeParse(entry.permission))
        .filter((entry) => entry.success)
        .map((entry) => entry.data),
    );
    const unauthorizedPermission = input.permissions.find((permission) => !granted.has(permission));
    if (unauthorizedPermission) {
      throw new ForbiddenException('Credential permissions must be held by the creator');
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('Credential expiry must be in the future');
    }

    const kind = input.kind === 'api_key' ? ApiCredentialKind.API_KEY : ApiCredentialKind.MCP_TOKEN;
    const token = `${tokenPrefixes[kind]}_${createToken(32)}`;
    const prefixLength = tokenPrefixes[kind].length + 7;

    const credential = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiCredential.create({
        data: {
          projectId: input.projectId,
          userId,
          createdById: userId,
          kind,
          name: input.name,
          tokenHash: hashToken(token),
          tokenPrefix: token.slice(0, prefixLength),
          tokenLastFour: token.slice(-4),
          permissions: input.permissions,
          expiresAt,
        },
        select: publicCredentialSelect,
      });
      await tx.activityEvent.create({
        data: {
          projectId: input.projectId,
          actorId: userId,
          action: 'CREATED',
          resourceType: 'api_credential',
          resourceId: created.id,
          metadata: { kind },
        },
      });
      return created;
    });

    return { ...credential, token };
  }

  async revoke(userId: string, credentialId: string) {
    const credential = await this.prisma.apiCredential.findFirst({
      where: { id: credentialId, userId, revokedAt: null },
      select: { id: true, projectId: true, kind: true },
    });
    if (!credential) throw new NotFoundException('Credential not found');

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.apiCredential.updateMany({
        where: { id: credential.id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!result.count) throw new NotFoundException('Credential not found');
      await tx.activityEvent.create({
        data: {
          projectId: credential.projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'api_credential',
          resourceId: credential.id,
          metadata: { kind: credential.kind },
        },
      });
      return tx.apiCredential.findUniqueOrThrow({
        where: { id: credential.id },
        select: publicCredentialSelect,
      });
    });
  }

  async authenticate(
    token: string,
    expectedKind: CredentialAudience,
  ): Promise<{
    user: NonNullable<Express.Request['user']>;
    credential: AuthenticatedCredential;
  }> {
    const expectedPrefix = `${tokenPrefixes[expectedKind]}_`;
    if (!token.startsWith(expectedPrefix) || token.length < expectedPrefix.length + 32) {
      throw new UnauthorizedException('Credential audience is invalid');
    }

    const record = await this.prisma.apiCredential.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        project: { select: { deletedAt: true } },
        user: {
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
          },
        },
      },
    });
    const now = new Date();
    if (
      !record ||
      record.kind !== expectedKind ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= now) ||
      record.project.deletedAt ||
      record.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Credential is invalid or inactive');
    }

    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: record.projectId, userId: record.userId } },
      select: { id: true },
    });
    if (!membership) throw new UnauthorizedException('Credential is invalid or inactive');

    const touched = await this.prisma.apiCredential.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
    if (!touched.count) throw new UnauthorizedException('Credential is invalid or inactive');

    const permissions = record.permissions.flatMap((permission) => {
      const parsed = permissionSchema.safeParse(permission);
      return parsed.success ? [parsed.data] : [];
    });
    return {
      user: record.user,
      credential: {
        id: record.id,
        projectId: record.projectId,
        userId: record.userId,
        kind: record.kind,
        permissions,
      },
    };
  }
}
