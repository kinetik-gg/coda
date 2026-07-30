import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { BreakdownScreenplayLinkController } from './breakdown-screenplay-link.controller';

const projectId = '30000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000002';
const screenplayId = '30000000-0000-4000-8000-000000000003';

const request = { user: { id: userId } } as unknown as Request;

function controllerWith() {
  const links = {
    get: vi.fn().mockResolvedValue(null),
    link: vi.fn().mockResolvedValue({ projectId, screenplayId }),
    unlink: vi.fn().mockResolvedValue({ projectId, linked: false }),
  };
  return { links, controller: new BreakdownScreenplayLinkController(links as never) };
}

describe('BreakdownScreenplayLinkController', () => {
  it('envelopes the absent link as null data rather than a 404', async () => {
    const { controller, links } = controllerWith();

    await expect(controller.get(request, projectId)).resolves.toEqual({ data: null });
    expect(links.get).toHaveBeenCalledWith(userId, projectId);
  });

  it('links the acting user request to the parsed screenplay id', async () => {
    const { controller, links } = controllerWith();

    const result = await controller.link(request, projectId, { screenplayId });

    expect(links.link).toHaveBeenCalledWith(userId, projectId, screenplayId);
    expect(result).toEqual({ data: { projectId, screenplayId } });
  });

  it.each([
    ['a missing screenplay id', {}],
    ['a non-uuid screenplay id', { screenplayId: 'not-a-uuid' }],
    ['an unexpected extra key', { screenplayId, cardinality: 'many' }],
  ])('rejects %s before reaching the service', async (_label, body) => {
    const { controller, links } = controllerWith();

    await expect(controller.link(request, projectId, body)).rejects.toBeInstanceOf(ZodError);
    expect(links.link).not.toHaveBeenCalled();
  });

  it('unlinks without a body', async () => {
    const { controller, links } = controllerWith();

    await expect(controller.unlink(request, projectId)).resolves.toEqual({
      data: { projectId, linked: false },
    });
    expect(links.unlink).toHaveBeenCalledWith(userId, projectId);
  });
});
