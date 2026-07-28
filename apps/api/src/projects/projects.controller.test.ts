import { describe, expect, it, vi } from 'vitest';
import { ProjectsController } from './projects.controller';

function controllerWith(projects: object) {
  return new ProjectsController(projects as never, {} as never);
}

describe('ProjectsController project detail', () => {
  it('validates and forwards an optional Space filter', async () => {
    const projects = { list: vi.fn().mockResolvedValue([]) };
    const controller = controllerWith(projects);
    const spaceId = '10000000-0000-4000-8000-000000000003';

    await expect(controller.list({ user: { id: 'user' } } as never, { spaceId })).resolves.toEqual({
      data: [],
    });
    expect(projects.list).toHaveBeenCalledWith('user', { spaceId });
    await expect(
      controller.list({ user: { id: 'user' } } as never, { spaceId: 'invalid' }),
    ).rejects.toThrow();
  });

  it('uses the external projection for a delegated credential', async () => {
    const projects = {
      get: vi.fn(),
      getExternal: vi.fn().mockResolvedValue({ id: 'project', name: 'Projected' }),
    };
    const controller = controllerWith(projects);

    await expect(
      controller.get(
        {
          user: { id: 'user' },
          apiCredential: { id: 'credential', projectId: 'project' },
        } as never,
        'project',
      ),
    ).resolves.toEqual({ data: { id: 'project', name: 'Projected' } });
    expect(projects.getExternal).toHaveBeenCalledWith('user', 'project');
    expect(projects.get).not.toHaveBeenCalled();
  });

  it('keeps the browser aggregate for a session request', async () => {
    const projects = {
      get: vi.fn().mockResolvedValue({ id: 'project', memberships: [] }),
      getExternal: vi.fn(),
    };
    const controller = controllerWith(projects);

    await expect(controller.get({ user: { id: 'user' } } as never, 'project')).resolves.toEqual({
      data: { id: 'project', memberships: [] },
    });
    expect(projects.get).toHaveBeenCalledWith('user', 'project');
    expect(projects.getExternal).not.toHaveBeenCalled();
  });
});
