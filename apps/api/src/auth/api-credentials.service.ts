import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  permissionSchema,
  trackerPermissionSchema,
  type CreateApiCredential,
} from '@coda/contracts';
import { ApiCredentialKind, type Prisma } from '@prisma/client';
import type { ZodType } from 'zod';
import { createToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerPermissionService } from '../trackers/tracker-permission.service';
import { PermissionService } from '../projects/permission.service';
import type { AuthenticatedCredential, CredentialAudience } from './request-auth-context';

const tokenPrefixes: Record<ApiCredentialKind, string> = {
  API_KEY: 'coda_api',
  MCP_TOKEN: 'coda_mcp',
};

const publicCredentialSelect = {
  id: true,
  projectId: true,
  trackerId: true,
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

type CredentialRecord = Prisma.ApiCredentialGetPayload<{
  include: { project: { select: { deletedAt: true } }; tracker: { select: { deletedAt: true } } };
}>;

@Injectable()
export class ApiCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectPermissions: PermissionService,
    private readonly trackerPermissions: TrackerPermissionService,
  ) {}

  async list(userId: string) {
    return this.prisma.apiCredential.findMany({
      where: { userId },
      select: {
        ...publicCredentialSelect,
        project: { select: { id: true, name: true, deletedAt: true } },
        tracker: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, input: CreateApiCredential) {
    const kind = input.kind === 'api_key' ? ApiCredentialKind.API_KEY : ApiCredentialKind.MCP_TOKEN;
    const granted = await this.creatorGrants(userId, input);
    assertSubset(input.permissions, granted);

    const expiresAt = parseExpiry(input.expiresAt);
    const token = mintToken(kind);
    const credential = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiCredential.create({
        data: {
          ...(input.resourceType === 'project'
            ? { projectId: input.projectId }
            : { trackerId: input.trackerId }),
          userId,
          createdById: userId,
          kind,
          name: input.name,
          tokenHash: hashToken(token),
          tokenPrefix: token.slice(0, tokenPrefixes[kind].length + 7),
          tokenLastFour: token.slice(-4),
          permissions: [...input.permissions],
          expiresAt,
        },
        select: publicCredentialSelect,
      });
      await tx.activityEvent.create({
        data: {
          ...(input.resourceType === 'project'
            ? { projectId: input.projectId }
            : { trackerId: input.trackerId }),
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

  /**
   * The subset rule runs against the creator's role IN THE TARGET resource — project roles for
   * project credentials, the same direct-membership-then-Space-tier resolution routes enforce
   * for tracker credentials. A credential can never hold an authority its creator lacks.
   */
  private async creatorGrants(userId: string, input: CreateApiCredential): Promise<Set<string>> {
    if (input.resourceType === 'tracker') {
      const membership = await this.trackerPermissions.membership(userId, input.trackerId);
      return new Set(membership.role.permissions.map((entry) => entry.permission));
    }
    const membership = await this.projectPermissions.membership(userId, input.projectId);
    return new Set(
      membership.role.permissions
        .map((entry) => permissionSchema.safeParse(entry.permission))
        .filter((entry) => entry.success)
        .map((entry) => entry.data),
    );
  }

  async revoke(userId: string, credentialId: string) {
    const credential = await this.prisma.apiCredential.findFirst({
      where: { id: credentialId, userId, revokedAt: null },
      select: { id: true, projectId: true, trackerId: true, kind: true },
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
          trackerId: credential.trackerId,
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
        tracker: { select: { deletedAt: true } },
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
      containerDeleted(record) ||
      record.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Credential is invalid or inactive');
    }
    if (!(await this.holdsMembership(record))) {
      throw new UnauthorizedException('Credential is invalid or inactive');
    }

    const touched = await this.prisma.apiCredential.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
    if (!touched.count) throw new UnauthorizedException('Credential is invalid or inactive');

    const credential: AuthenticatedCredential = record.trackerId
      ? {
          resourceType: 'tracker',
          id: record.id,
          trackerId: record.trackerId,
          userId: record.userId,
          kind: record.kind,
          permissions: parseVocabulary(record.permissions, trackerPermissionSchema),
        }
      : {
          resourceType: 'project',
          id: record.id,
          projectId: record.projectId!,
          userId: record.userId,
          kind: record.kind,
          permissions: parseVocabulary(record.permissions, permissionSchema),
        };
    return { user: record.user, credential };
  }

  /**
   * The membership proof mirrors the route-time rule: a credential stays valid only while its
   * owning user still holds a direct membership on the bound resource. Space reach never
   * substitutes — a credential addresses exactly the one resource it was minted for.
   */
  private async holdsMembership(record: CredentialRecord): Promise<boolean> {
    if (record.projectId) {
      const membership = await this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId: record.projectId, userId: record.userId } },
        select: { id: true },
      });
      return Boolean(membership);
    }
    const membership = await this.prisma.trackerMembership.findUnique({
      where: {
        trackerId_userId: { trackerId: record.trackerId as string, userId: record.userId },
      },
      select: { id: true },
    });
    return Boolean(membership);
  }
}

function containerDeleted(record: CredentialRecord): boolean {
  if (record.projectId) return Boolean(record.project?.deletedAt);
  return Boolean(record.tracker?.deletedAt);
}

function mintToken(kind: ApiCredentialKind): string {
  return `${tokenPrefixes[kind]}_${createToken(32)}`;
}

function parseVocabulary<T extends string>(raw: string[], schema: ZodType<T>): T[] {
  return raw.flatMap((permission) => {
    const parsed = schema.safeParse(permission);
    return parsed.success ? [parsed.data] : [];
  });
}

function assertSubset(requested: readonly string[], granted: Set<string>): void {
  if (requested.some((permission) => !granted.has(permission))) {
    throw new ForbiddenException('Credential permissions must be held by the creator');
  }
}

function parseExpiry(expiresAt: string | null | undefined): Date | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (date <= new Date()) throw new BadRequestException('Credential expiry must be in the future');
  return date;
}
