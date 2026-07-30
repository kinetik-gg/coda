import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { SourceRevisionPinController } from './source-revision-pin.controller';

const projectId = '50000000-0000-4000-8000-000000000001';
const userId = '50000000-0000-4000-8000-000000000002';
const itemId = '50000000-0000-4000-8000-000000000003';
const referenceId = '50000000-0000-4000-8000-000000000004';

const request = { user: { id: userId } } as unknown as Request;
const unpinned = { id: referenceId, resolution: 'unpinned', pin: null, sourceText: null };
const pinned = { id: referenceId, resolution: 'pinned', sourceText: 'MAYA waits.' };

function controllerWith() {
  const pins = {
    get: vi.fn().mockResolvedValue(unpinned),
    pin: vi.fn().mockResolvedValue(pinned),
    unpin: vi.fn().mockResolvedValue(unpinned),
  };
  return { pins, controller: new SourceRevisionPinController(pins as never) };
}

describe('SourceRevisionPinController', () => {
  it('envelopes an unpinned reference as resolution state rather than a 404', async () => {
    const { controller, pins } = controllerWith();

    await expect(controller.get(request, projectId, itemId, referenceId)).resolves.toEqual({
      data: unpinned,
    });
    expect(pins.get).toHaveBeenCalledWith(userId, projectId, itemId, referenceId);
  });

  it('passes the parsed version and range through to the service', async () => {
    const { controller, pins } = controllerWith();

    const result = await controller.pin(request, projectId, itemId, referenceId, {
      screenplayVersion: 7,
      source: { start: 20, end: 48 },
    });

    expect(pins.pin).toHaveBeenCalledWith(userId, projectId, itemId, referenceId, {
      screenplayVersion: 7,
      source: { start: 20, end: 48 },
    });
    expect(result).toEqual({ data: pinned });
  });

  it.each([
    ['a missing version', { source: { start: 0, end: 4 } }],
    ['a missing range', { screenplayVersion: 7 }],
    ['an empty range', { screenplayVersion: 7, source: { start: 4, end: 4 } }],
    ['an inverted range', { screenplayVersion: 7, source: { start: 9, end: 4 } }],
    ['a negative offset', { screenplayVersion: 7, source: { start: -1, end: 4 } }],
    [
      'a range past the source ceiling',
      { screenplayVersion: 7, source: { start: 0, end: 5_000_001 } },
    ],
    [
      'a client-chosen revision id',
      {
        screenplayVersion: 7,
        source: { start: 0, end: 4 },
        screenplayRevisionId: '50000000-0000-4000-8000-000000000005',
      },
    ],
  ])('rejects %s before reaching the service', async (_label, body) => {
    const { controller, pins } = controllerWith();

    await expect(
      controller.pin(request, projectId, itemId, referenceId, body),
    ).rejects.toBeInstanceOf(ZodError);
    expect(pins.pin).not.toHaveBeenCalled();
  });

  it('unpins without a body and reports the reference back on its PDF', async () => {
    const { controller, pins } = controllerWith();

    await expect(controller.unpin(request, projectId, itemId, referenceId)).resolves.toEqual({
      data: unpinned,
    });
    expect(pins.unpin).toHaveBeenCalledWith(userId, projectId, itemId, referenceId);
  });
});
