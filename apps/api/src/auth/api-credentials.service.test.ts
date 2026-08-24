import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiCredentialKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { TrackerPermissionService } from '../trackers/tracker-permission.service';
import { hashToken } from '../common/crypto';
import { PermissionService } from '../projects/permission.service';
import { ApiCredentialsService } from './api-credentials.service';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'developer@example.test',
  displayName: 'Developer',
  company: null,
  department: null,
  theme: 'coda-dark',
  fontSize: 'default',
  motionPreference: 'system',
  pdfAppearance: 'theme',
  status: 'ACTIVE',
} as const;
const projectId = '10000000-0000-4000-8000-000000000002';
const trackerId = '10000000-0000-4000-8000-000000000004';
const credentialId = '10000000-0000-4000-8000-000000000003';

function roleMembership(permissions: string[]) {
  return {
    role: { permissions: permissions.map((permission) => ({ permission })) },
  };
}

function serviceWith(
  prisma: object,
  projectGrants = ['read_project', 'manage_items'],
  trackerGrants = ['read_tracker', 'edit_tracker_records'],
) {
  const projectPermissions = {
    membership: vi.fn().mockResolvedValue(roleMembership(projectGrants)),
  };
  const trackerPermissions = {
    membership: vi.fn().mockResolvedValue(roleMembership(trackerGrants)),
  };
  return {
    service: new ApiCredentialsService(
      prisma as never,
      projectPermissions as unknown as PermissionService,
      trackerPermissions as unknown as TrackerPermissionService,
    ),
    projectPermissions,
    trackerPermissions,
  };
}

function activeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: credentialId,
    projectId,
    trackerId: null,
    userId: user.id,
    kind: ApiCredentialKind.API_KEY,
    permissions: ['read_project'],
    expiresAt: null,
    revokedAt: null,
    project: { deletedAt: null },
    tracker: { deletedAt: null },
    user,
    ...overrides,
  };
}

describe('ApiCredentialsService', () => {
  it('returns plaintext once while persisting only its hash and safe display metadata', async () => {
    const create = vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: credentialId,
        projectId,
        trackerId: null,
        userId: user.id,
        kind: data.kind,
        name: data.name,
        tokenPrefix: data.tokenPrefix,
        tokenLastFour: data.tokenLastFour,
        permissions: data.permissions,
        expiresAt: data.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      }),
    );
    const tx = {
      apiCredential: { create },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = serviceWith(prisma);

    const result = await service.create(user.id, {
      resourceType: 'project',
      projectId,
      name: 'Automation',
      kind: 'api_key',
      permissions: ['read_project', 'manage_items'],
      expiresAt: null,
    });

    const persisted = create.mock.calls[0]![0].data;
    expect(result.token).toMatch(/^coda_api_[A-Za-z0-9_-]{40,}$/);
    expect(persisted.tokenHash).toBe(hashToken(result.token));
    expect(Object.values(persisted)).not.toContain(result.token);
    expect(result.tokenPrefix).toBe(result.token.slice(0, 'coda_api_'.length + 6));
    expect(result.tokenLastFour).toBe(result.token.slice(-4));
    expect(tx.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId,
        actorId: user.id,
        action: 'CREATED',
        resourceType: 'api_credential',
        resourceId: credentialId,
        metadata: { kind: 'API_KEY' },
      },
    });
  });

  it('rejects a requested scope the creator does not currently hold', async () => {
    const { service } = serviceWith({}, ['read_project']);

    await expect(
      service.create(user.id, {
        resourceType: 'project',
        projectId,
        name: 'Over-scoped',
        kind: 'api_key',
        permissions: ['read_project', 'delete_project'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ApiCredentialsService tracker scope', () => {
  it('binds exactly one tracker and reports the same display metadata shape', async () => {
    const create = vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: credentialId,
        projectId: null,
        trackerId: data.trackerId,
        userId: user.id,
        kind: data.kind,
        name: data.name,
        tokenPrefix: data.tokenPrefix,
        tokenLastFour: data.tokenLastFour,
        permissions: data.permissions,
        expiresAt: data.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      }),
    );
    const activityCreate = vi.fn().mockResolvedValue({});
    const tx = {
      apiCredential: { create },
      activityEvent: { create: activityCreate },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const { service, trackerPermissions } = serviceWith(prisma);

    const result = await service.create(user.id, {
      resourceType: 'tracker',
      trackerId,
      name: 'Grid sync',
      kind: 'mcp_token',
      permissions: ['edit_tracker_records'],
    });

    const persisted = create.mock.calls[0]![0].data;
    expect(persisted.trackerId).toBe(trackerId);
    expect(persisted.projectId).toBeUndefined();
    expect(result.token).toMatch(/^coda_mcp_[A-Za-z0-9_-]{40,}$/);
    expect(persisted.tokenHash).toBe(hashToken(result.token));
    expect(result.tokenPrefix).toBe(result.token.slice(0, 'coda_mcp_'.length + 6));
    expect(result.tokenLastFour).toBe(result.token.slice(-4));

    // The subset rule validates against the creator's role IN THAT tracker.
    expect(trackerPermissions.membership).toHaveBeenCalledWith(user.id, trackerId);
    const createdEvent = activityCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(createdEvent.data).toMatchObject({
      trackerId,
      action: 'CREATED',
      resourceType: 'api_credential',
    });
  });

  it('rejects a tracker scope exceeding the creator role in that tracker', async () => {
    const { service } = serviceWith({}, undefined, ['read_tracker']);

    await expect(
      service.create(user.id, {
        resourceType: 'tracker',
        trackerId,
        name: 'Over-scoped',
        kind: 'api_key',
        permissions: ['manage_tracker_fields'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ApiCredentialsService authentication', () => {
  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 1_000) }],
    ['revoked', { revokedAt: new Date() }],
  ])('rejects an %s credential', async (_label, overrides) => {
    const prisma = {
      apiCredential: { findUnique: vi.fn().mockResolvedValue(activeRecord(overrides)) },
    };
    const { service } = serviceWith(prisma);

    await expect(service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects using an MCP token in the API-key audience', async () => {
    const findUnique = vi.fn();
    const { service } = serviceWith({ apiCredential: { findUnique } });

    await expect(service.authenticate(`coda_mcp_${'a'.repeat(43)}`, 'API_KEY')).rejects.toThrow(
      'audience',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('authenticates an active project member and records last use', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      apiCredential: {
        findUnique: vi.fn().mockResolvedValue(activeRecord()),
        updateMany,
      },
      projectMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const { service } = serviceWith(prisma);

    const result = await service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY');

    expect(result.credential).toEqual({
      resourceType: 'project',
      id: credentialId,
      projectId,
      userId: user.id,
      kind: 'API_KEY',
      permissions: ['read_project'],
    });
    const update = updateMany.mock.calls[0]![0] as unknown as {
      where: { id: string; revokedAt: null };
      data: { lastUsedAt: Date };
    };
    expect(update.where).toEqual({ id: credentialId, revokedAt: null });
    expect(update.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it('rejects a credential after its project membership is removed', async () => {
    const prisma = {
      apiCredential: { findUnique: vi.fn().mockResolvedValue(activeRecord()) },
      projectMembership: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWith(prisma);

    await expect(service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('authenticates a bound tracker member through the tracker vocabulary', async () => {
    const prisma = {
      apiCredential: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            activeRecord({
              projectId: null,
              trackerId,
              permissions: ['read_tracker', 'edit_tracker_records'],
            }),
          ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'membership' }) },
    };
    const { service } = serviceWith(prisma);

    const result = await service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY');

    expect(prisma.apiCredential.findUnique.mock.calls[0]![0]).toMatchObject({
      include: {
        project: { select: { deletedAt: true } },
        tracker: { select: { deletedAt: true } },
      },
    });
    expect(result.credential).toEqual({
      resourceType: 'tracker',
      id: credentialId,
      trackerId,
      userId: user.id,
      kind: 'API_KEY',
      permissions: ['read_tracker', 'edit_tracker_records'],
    });
    expect(prisma.trackerMembership.findUnique).toHaveBeenCalledWith({
      where: { trackerId_userId: { trackerId, userId: user.id } },
      select: { id: true },
    });
  });

  it('rejects a tracker credential once its tracker membership is removed', async () => {
    const prisma = {
      apiCredential: {
        findUnique: vi.fn().mockResolvedValue(activeRecord({ projectId: null, trackerId })),
      },
      trackerMembership: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWith(prisma);

    await expect(service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a tracker credential whose tracker is in trash', async () => {
    const prisma = {
      apiCredential: {
        findUnique: vi.fn().mockResolvedValue(
          activeRecord({
            projectId: null,
            trackerId,
            tracker: { deletedAt: new Date() },
          }),
        ),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(service.authenticate(`coda_api_${'a'.repeat(43)}`, 'API_KEY')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('PermissionService credential tenant scope', () => {
  function credentialContext(credential: object) {
    return { credential: () => credential };
  }

  it('does not resolve another project through a bound credential', async () => {
    const prisma = { projectMembership: { findUnique: vi.fn() } };
    const authContext = credentialContext({
      resourceType: 'project',
      id: credentialId,
      projectId,
      userId: user.id,
      kind: 'API_KEY',
      permissions: ['read_project'],
    });
    const permissions = new PermissionService(prisma as never, authContext as never);

    await expect(
      permissions.assert(user.id, '10000000-0000-4000-8000-000000000099', 'read_project'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('enforces the credential scope before the current membership permission', async () => {
    const prisma = { projectMembership: { findUnique: vi.fn() } };
    const authContext = credentialContext({
      resourceType: 'project',
      id: credentialId,
      projectId,
      userId: user.id,
      kind: 'API_KEY',
      permissions: ['read_project'],
    });
    const permissions = new PermissionService(prisma as never, authContext as never);

    await expect(permissions.assert(user.id, projectId, 'manage_items')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
  });
});
