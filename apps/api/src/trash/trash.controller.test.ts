import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrashController, TrashedProjectsController } from './trash.controller';

function controllerHarness() {
  const calls: Array<{ method: string; arguments: unknown[] }> = [];
  const trash = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...parameters: unknown[]) => {
          calls.push({ method, arguments: parameters });
          return Promise.resolve({ id: parameters.at(-1) ?? `${method}-result` });
        },
    },
  );
  const realtime = { invalidateProject: vi.fn().mockResolvedValue(undefined) };
  return {
    calls,
    realtime,
    controller: new TrashController(trash as never, realtime as never),
    projects: new TrashedProjectsController(trash as never),
  };
}

const request = { user: { id: 'user-1' } } as Request;

describe('trash controllers', () => {
  it('delegates project and item lifecycle routes with the authenticated actor', async () => {
    const { controller, projects, calls, realtime } = controllerHarness();

    await projects.list(request);
    await controller.list(request, 'project-1');
    await controller.trashProject(request, 'project-1');
    await controller.restoreProject(request, 'project-1');
    await controller.purgeProject(request, 'project-1');
    await controller.trashItem(request, 'project-1', 'item-1');
    await controller.restoreBatch(request, 'project-1', 'batch-1');
    await controller.purgeItem(request, 'project-1', 'item-1');

    expect(calls.map(({ method }) => method)).toEqual([
      'listTrashedProjects',
      'list',
      'trashProject',
      'restoreProject',
      'purgeProject',
      'trashItem',
      'restoreBatch',
      'purgeItem',
    ]);
    expect(calls[2]?.arguments).toEqual(['user-1', 'project-1']);
    expect(realtime.invalidateProject).toHaveBeenCalledWith('project-1', 'items', []);
  });

  it('delegates field lifecycle routes and validates optimistic versions', async () => {
    const { controller, calls, realtime } = controllerHarness();

    await controller.trashField(request, 'project-1', 'field-1', { version: 4 });
    await controller.restoreField(request, 'project-1', 'field-1');
    await controller.purgeField(request, 'project-1', 'field-1');

    expect(calls[0]).toEqual({
      method: 'trashField',
      arguments: ['user-1', 'project-1', 'field-1', { version: 4 }],
    });
    expect(realtime.invalidateProject).toHaveBeenCalledTimes(3);
  });

  it('delegates source-document and storage-object lifecycle routes', async () => {
    const { controller, calls, realtime } = controllerHarness();

    await controller.trashSourceDocument(request, 'project-1', 'document-1');
    await controller.restoreSourceDocument(request, 'project-1', 'document-1');
    await controller.purgeSourceDocument(request, 'project-1', 'document-1');
    await controller.trashStorageObject(request, 'project-1', 'storage-1');
    await controller.restoreStorageObject(request, 'project-1', 'storage-1');
    await controller.purgeStorageObject(request, 'project-1', 'storage-1');

    expect(calls.map(({ method }) => method)).toEqual([
      'trashSourceDocument',
      'restoreSourceDocument',
      'purgeSourceDocument',
      'trashStorageObject',
      'restoreStorageObject',
      'purgeStorageObject',
    ]);
    expect(realtime.invalidateProject).toHaveBeenCalledTimes(6);
  });
});
