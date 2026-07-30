import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayRebasePreviewController } from './screenplay-rebase-preview.controller';

const userId = '00000000-0000-4000-8000-0000000000e1';
const projectId = '00000000-0000-4000-8000-000000000001';

function harness(plan: unknown = { planVersion: 1 }) {
  const preview = { preview: vi.fn(() => Promise.resolve(plan)) };
  const controller = new ScreenplayRebasePreviewController(preview as never);
  const request = { user: { id: userId } } as unknown as Request;
  return { controller, preview, request };
}

describe('ScreenplayRebasePreviewController', () => {
  it('answers with the plan in the standard envelope', async () => {
    const { controller, preview, request } = harness();
    await expect(controller.get(request, projectId)).resolves.toEqual({ data: { planVersion: 1 } });
    expect(preview.preview).toHaveBeenCalledWith(userId, projectId, undefined);
  });

  it('passes a supplied screenplay version through for optimistic concurrency', async () => {
    const { controller, preview, request } = harness();
    await controller.get(request, projectId, '12');
    expect(preview.preview).toHaveBeenCalledWith(userId, projectId, 12);
  });

  it.each(['abc', '0', '-3', '2.5'])('rejects %s as a screenplay version', async (raw) => {
    const { controller, request } = harness();
    await expect(controller.get(request, projectId, raw)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('treats an empty query value as no version at all', async () => {
    const { controller, preview, request } = harness();
    await controller.get(request, projectId, '');
    expect(preview.preview).toHaveBeenCalledWith(userId, projectId, undefined);
  });

  it('exposes the preview on a safe method only', () => {
    // The zero-writes guarantee is stated at the HTTP layer, not only in prose: the controller has a
    // single `@Get` and no body, so the route is repeatable and side-effect-free by construction.
    // The mutation lives in #243, on its own route.
    const source = readFileSync(join(__dirname, 'screenplay-rebase-preview.controller.ts'), 'utf8');
    expect(source).toContain('@Get()');
    for (const decorator of ['@Post(', '@Put(', '@Patch(', '@Delete(', '@Body(']) {
      expect(source).not.toContain(decorator);
    }
  });
});
