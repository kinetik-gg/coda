import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiCredentialKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
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
const credentialId = '10000000-0000-4000-8000-000000000003';

function serviceWith(prisma: object, granted = ['read_project', 'manage_items']) {
  const permissionService = {
    membership: vi.fn().mockResolvedValue({
      role: { permissions: granted.map((permission) => ({ permission })) },
    }),
  };
  return {
    service: new ApiCredentialsService(prisma as never, permissionService as never),
    permissionService,
  };
}

function activeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: credentialId,
    projectId,
    userId: user.id,
    kind: ApiCredentialKind.API_KEY,
    permissions: ['read_project'],
    expiresAt: null,
    revokedAt: null,
    project: { deletedAt: null },
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
        projectId,
        name: 'Over-scoped',
        kind: 'api_key',
        permissions: ['read_project', 'delete_project'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

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
});

describe('PermissionService credential tenant scope', () => {
  it('does not resolve another project through a bound credential', async () => {
    const prisma = { projectMembership: { findUnique: vi.fn() } };
    const authContext = {
      credential: () => ({
        id: credentialId,
        projectId,
        userId: user.id,
        kind: 'API_KEY',
        permissions: ['read_project'],
      }),
    };
    const permissions = new PermissionService(prisma as never, authContext as never);

    await expect(
      permissions.assert(user.id, '10000000-0000-4000-8000-000000000099', 'read_project'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
  });

  it('enforces the credential scope before the current membership permission', async () => {
    const prisma = { projectMembership: { findUnique: vi.fn() } };
    const authContext = {
      credential: () => ({
        id: credentialId,
        projectId,
        userId: user.id,
        kind: 'API_KEY',
        permissions: ['read_project'],
      }),
    };
    const permissions = new PermissionService(prisma as never, authContext as never);

    await expect(permissions.assert(user.id, projectId, 'manage_items')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.projectMembership.findUnique).not.toHaveBeenCalled();
  });
});
