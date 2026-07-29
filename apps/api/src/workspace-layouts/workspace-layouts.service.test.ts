import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const conflictMetric = vi.fn();

function serviceWith(prisma: object, member = membership()) {
  const permissions = { membership: vi.fn().mockResolvedValue(member) };
  const metrics = { recordWorkspaceLayoutConflict: conflictMetric };
  return new WorkspaceLayoutsService(prisma as never, permissions as never, metrics as never);
}

describe('WorkspaceLayoutsService', () => {
  beforeEach(() => {
    conflictMetric.mockReset();
  });

  it('creates a published default and owner personal layout together', async () => {
    const tx = {
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
      projectUserWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
    };
    const layout = createDefaultWorkspaceLayout();

    await createProjectWorkspaceLayouts(tx as never, projectId, membershipId, userId, layout);

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
    expect(tx.projectUserWorkspaceLayout.create).toHaveBeenCalledWith({
      data: {
        projectId,
        userId,
        layout,
        schemaVersion: 1,
        basedOnDefaultRevision: 0,
      },
    });
  });

  it('allows any member to save a personal layout without shared side effects', async () => {
    const saved = { projectId, userId, revision: 3 };
    const tx = {
      projectWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValue({
          projectId,
          layout: createDefaultWorkspaceLayout(),
          schemaVersion: 1,
          revision: 0,
        }),
      },
      projectUserWorkspaceLayout: {
        upsert: vi.fn().mockResolvedValue({ revision: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
      },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      project: { update: vi.fn() },
      activityEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const layout = createDefaultWorkspaceLayout();
    const service = serviceWith(prisma, membership('another-owner'));

    await expect(service.save(userId, projectId, layout, 2)).resolves.toBe(saved);
    expect(tx.projectUserWorkspaceLayout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId, userId, revision: 2 } }),
    );
    expect(tx.projectMembershipWorkspaceLayout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { membershipId, revision: 2 } }),
    );
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.activityEvent.create).not.toHaveBeenCalled();
  });

  it('returns a user-keyed personal layout with owner publication capability', async () => {
    const personal = { projectId, userId, revision: 2 };
    const published = { projectId, revision: 4 };
    const tx = {
      projectUserWorkspaceLayout: { upsert: vi.fn().mockResolvedValue(personal) },
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(published) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };

    await expect(serviceWith(prisma).get(userId, projectId)).resolves.toEqual({
      personal,
      default: published,
      canPublish: true,
    });
    await expect(
      serviceWith(prisma, membership('another-owner')).get(userId, projectId),
    ).resolves.toEqual({ personal, default: published, canPublish: false });
    expect(tx.projectUserWorkspaceLayout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId_userId: { projectId, userId } } }),
    );
  });

  it('rejects get when the published default is absent', async () => {
    const tx = {
      projectUserWorkspaceLayout: { upsert: vi.fn() },
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await expect(serviceWith(prisma).get(userId, projectId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.projectUserWorkspaceLayout.upsert).not.toHaveBeenCalled();
  });

  it('returns a conflict for a stale personal save', async () => {
    const tx = {
      projectWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValue({
          layout: createDefaultWorkspaceLayout(),
          schemaVersion: 1,
          revision: 0,
        }),
      },
      projectUserWorkspaceLayout: {
        upsert: vi.fn().mockResolvedValue({ revision: 8 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma);

    await expect(
      service.save(userId, projectId, createDefaultWorkspaceLayout(), 8),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(conflictMetric).toHaveBeenCalledWith('save');
  });

  it('resets personal state from the latest default and records provenance', async () => {
    const publishedDefault = {
      projectId,
      layout: createDefaultWorkspaceLayout(),
      schemaVersion: 1,
      revision: 4,
    };
    const reset = { projectId, userId, revision: 3, basedOnDefaultRevision: 4 };
    const tx = {
      projectWorkspaceDefault: { findUnique: vi.fn().mockResolvedValue(publishedDefault) },
      projectUserWorkspaceLayout: {
        upsert: vi.fn().mockResolvedValue({ revision: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(reset),
      },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, membership('another-owner'));

    await expect(service.reset(userId, projectId, 2)).resolves.toBe(reset);
    const resetUpdate = tx.projectUserWorkspaceLayout.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(resetUpdate).toMatchObject({
      where: { projectId, userId, revision: 2 },
      data: {
        layout: publishedDefault.layout,
        basedOnDefaultRevision: 4,
        revision: { increment: 1 },
      },
    });
    expect(tx.projectMembershipWorkspaceLayout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { membershipId, revision: 2 } }),
    );
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
      projectUserWorkspaceLayout: {
        upsert: vi.fn().mockResolvedValue({ revision: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      projectMembershipWorkspaceLayout: {
        updateMany: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma);

    await expect(service.reset(userId, projectId, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reset(userId, projectId, 1)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectUserWorkspaceLayout.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(conflictMetric).toHaveBeenCalledWith('reset');
    expect(conflictMetric).toHaveBeenCalledTimes(1);
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
      projectUserWorkspaceLayout: {
        upsert: vi.fn().mockResolvedValue({ projectId, userId, layout, revision: 3 }),
        findFirst: vi.fn().mockResolvedValue({ projectId, userId, layout, revision: 3 }),
      },
      projectWorkspaceDefault: {
        findUnique: vi.fn().mockResolvedValue(current),
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
    expect(tx.projectUserWorkspaceLayout.findFirst).toHaveBeenCalledWith({
      where: { projectId, userId, revision: 3 },
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
        projectUserWorkspaceLayout: {
          upsert: vi.fn().mockResolvedValue(personal),
          findFirst: vi.fn().mockResolvedValue(personal),
        },
        projectWorkspaceDefault: {
          findUnique: vi.fn().mockResolvedValue({
            layout: createDefaultWorkspaceLayout(),
            schemaVersion: 1,
            revision: 3,
          }),
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
      if (exception === ConflictException) {
        expect(conflictMetric).toHaveBeenCalledWith('publish');
      } else {
        expect(conflictMetric).not.toHaveBeenCalled();
      }
    },
  );
});
