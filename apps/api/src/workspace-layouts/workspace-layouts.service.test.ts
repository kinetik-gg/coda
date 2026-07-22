import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultWorkspaceLayout,
  createProjectWorkspaceLayouts,
} from './default-workspace-layout';
import { WorkspaceLayoutsService } from './workspace-layouts.service';

const projectId = '10000000-0000-4000-8000-000000000010';
const userId = '10000000-0000-4000-8000-000000000011';
const membershipId = '10000000-0000-4000-8000-000000000012';

function membership(ownerUserId = userId) {
  return { id: membershipId, project: { ownerUserId } };
}

function serviceWith(prisma: object, member = membership()) {
  const permissions = { membership: vi.fn().mockResolvedValue(member) };
  return new WorkspaceLayoutsService(prisma as never, permissions as never);
}

describe('WorkspaceLayoutsService', () => {
  it('creates a published default and owner personal layout together', async () => {
    const tx = {
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
    };
    const layout = createDefaultWorkspaceLayout();

    await createProjectWorkspaceLayouts(tx as never, projectId, membershipId, layout);

    const defaultCreate = tx.projectWorkspaceDefault.create.mock.calls[0]![0] as unknown as {
      data: Record<string, unknown>;
    };
    const personalCreate = tx.projectMembershipWorkspaceLayout.create.mock
      .calls[0]![0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(defaultCreate.data).toMatchObject({ projectId, layout, schemaVersion: 1 });
    expect(personalCreate.data).toMatchObject({
      membershipId,
      layout,
      schemaVersion: 1,
      basedOnDefaultRevision: 0,
    });
  });

  it('allows any member to save a personal layout without shared side effects', async () => {
    const saved = { membershipId, revision: 3 };
    const prisma = {
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
      },
      project: { update: vi.fn() },
      activityEvent: { create: vi.fn() },
    };
    const layout = createDefaultWorkspaceLayout();
    const service = serviceWith(prisma, membership('another-owner'));

    await expect(service.save(userId, projectId, layout, 2)).resolves.toBe(saved);
    expect(prisma.projectMembershipWorkspaceLayout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { membershipId, revision: 2 } }),
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
  });

  it('returns personal and published layouts with owner publication capability', async () => {
    const personal = { membershipId, revision: 2 };
    const published = { projectId, revision: 4 };
    const prisma = {
      projectMembershipWorkspaceLayout: { findUnique: vi.fn().mockResolvedValue(personal) },
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(published) },
    };

    await expect(serviceWith(prisma).get(userId, projectId)).resolves.toEqual({
      personal,
      default: published,
      canPublish: true,
    });
    await expect(
      serviceWith(prisma, membership('another-owner')).get(userId, projectId),
    ).resolves.toEqual({ personal, default: published, canPublish: false });
  });

  it.each([
    ['published default', null, { membershipId }],
    ['personal layout', { projectId }, null],
  ])('rejects get when the %s is absent', async (_label, published, personal) => {
    const prisma = {
      projectMembershipWorkspaceLayout: { findUnique: vi.fn().mockResolvedValue(personal) },
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(published) },
    };
    await expect(serviceWith(prisma).get(userId, projectId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a conflict for a stale personal save', async () => {
    const prisma = {
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = serviceWith(prisma);

    await expect(
      service.save(userId, projectId, createDefaultWorkspaceLayout(), 8),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resets personal state from the latest default and records provenance', async () => {
    const publishedDefault = {
      projectId,
      layout: createDefaultWorkspaceLayout(),
      schemaVersion: 1,
      revision: 4,
    };
    const reset = { membershipId, revision: 3, basedOnDefaultRevision: 4 };
    const tx = {
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(publishedDefault) },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(reset),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, membership('another-owner'));

    await expect(service.reset(userId, projectId, 2)).resolves.toBe(reset);
    const resetUpdate = tx.projectMembershipWorkspaceLayout.updateMany.mock
      .calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(resetUpdate).toMatchObject({
      where: { membershipId, revision: 2 },
      data: {
        layout: publishedDefault.layout,
        basedOnDefaultRevision: 4,
        revision: { increment: 1 },
      },
    });
  });

  it('rejects reset when the default is missing or the personal revision is stale', async () => {
    const tx = {
      projectWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          projectId,
          layout: createDefaultWorkspaceLayout(),
          schemaVersion: 1,
          revision: 1,
        }),
      },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma);

    await expect(service.reset(userId, projectId, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reset(userId, projectId, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectMembershipWorkspaceLayout.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects default publication by a non-owner', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = serviceWith(prisma, membership('another-owner'));

    await expect(service.publish(userId, projectId, 1, 1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes the saved owner layout with both optimistic revisions', async () => {
    const layout = createDefaultWorkspaceLayout();
    const current = { projectId, layout, schemaVersion: 1, revision: 6 };
    const tx = {
      projectMembershipWorkspaceLayout: {
        findFirst: vi.fn().mockResolvedValue({ membershipId, layout, revision: 3 }),
      },
      projectWorkspaceDefault: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
      },
      project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma);

    await expect(service.publish(userId, projectId, 3, 5)).resolves.toBe(current);
    expect(tx.projectMembershipWorkspaceLayout.findFirst).toHaveBeenCalledWith({
      where: { membershipId, revision: 3 },
    });
    expect(tx.projectWorkspaceDefault.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId, revision: 5 } }),
    );
    expect(tx.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: projectId, ownerUserId: userId, deletedAt: null } }),
    );
    expect(tx.activityEvent.create).toHaveBeenCalledOnce();
  });

  it.each([
    ['personal revision', null, { count: 1 }, { count: 1 }, ConflictException],
    [
      'default revision',
      { layout: createDefaultWorkspaceLayout() },
      { count: 0 },
      { count: 1 },
      ConflictException,
    ],
    [
      'owner project',
      { layout: createDefaultWorkspaceLayout() },
      { count: 1 },
      { count: 0 },
      ForbiddenException,
    ],
  ])(
    'rejects publication when the %s has changed',
    async (_label, personal, defaultUpdate, projectUpdate, exception) => {
      const tx = {
        projectMembershipWorkspaceLayout: { findFirst: vi.fn().mockResolvedValue(personal) },
        projectWorkspaceDefault: {
          updateMany: vi.fn().mockResolvedValue(defaultUpdate),
          findUniqueOrThrow: vi.fn(),
        },
        project: { updateMany: vi.fn().mockResolvedValue(projectUpdate) },
        activityEvent: { create: vi.fn() },
      };
      const prisma = {
        $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
      };

      await expect(serviceWith(prisma).publish(userId, projectId, 2, 3)).rejects.toBeInstanceOf(
        exception,
      );
      expect(tx.activityEvent.create).not.toHaveBeenCalled();
    },
  );
});
