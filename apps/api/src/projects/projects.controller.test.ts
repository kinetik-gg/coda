import { describe, expect, it, vi } from 'vitest';
import { ProjectsController } from './projects.controller';

function controllerWith(projects: object) {
  return new ProjectsController(projects as never, {} as never);
}

describe('ProjectsController project detail', () => {
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
