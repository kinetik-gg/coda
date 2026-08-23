import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrackerCommentsController } from './tracker-comments.controller';

const TRACKER = '10000000-0000-4000-8000-000000000001';
const RECORD = '30000000-0000-4000-8000-000000000003';
const COMMENT = '40000000-0000-4000-8000-000000000004';

function request(): Request {
  return { user: { id: 'owner-id' } } as unknown as Request;
}

function comment(id: string) {
  return { id, recordId: RECORD, authorId: 'owner-id', body: 'Note' };
}

function setup() {
  const comments = {
    list: vi.fn().mockResolvedValue({ data: [comment(COMMENT)], nextCursor: null }),
    create: vi.fn().mockResolvedValue(comment('c-new')),
    update: vi.fn().mockResolvedValue(comment(COMMENT)),
    remove: vi.fn().mockResolvedValue({ id: COMMENT, deletedAt: new Date() }),
  };
  const realtime = { invalidateTracker: vi.fn().mockResolvedValue(undefined) };
  const controller = new TrackerCommentsController(comments as never, realtime as never);
  return { controller, comments, realtime };
}

describe('TrackerCommentsController', () => {
  it('returns the paginated envelope and emits nothing on reads', async () => {
    const { controller, realtime } = setup();

    const response = await controller.list(request(), TRACKER, RECORD, {});
    expect(response).toEqual({
      data: [comment(COMMENT)],
      meta: { nextCursor: null },
    });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });

  it('invalidates the comments resource after every mutation', async () => {
    const { controller, realtime } = setup();

    await controller.create(request(), TRACKER, RECORD, { body: 'New' });
    await controller.update(request(), TRACKER, RECORD, COMMENT, { body: 'Edited', version: 1 });
    await controller.remove(request(), TRACKER, RECORD, COMMENT);

    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(3);
    expect(realtime.invalidateTracker.mock.calls[0]).toEqual([TRACKER, 'comments', ['c-new']]);
    expect(realtime.invalidateTracker.mock.calls[1]).toEqual([TRACKER, 'comments', [COMMENT]]);
    expect(realtime.invalidateTracker.mock.calls[2]).toEqual([TRACKER, 'comments', [COMMENT]]);
  });

  it('parses bodies through the comment contracts before reaching the service', async () => {
    const { controller, comments } = setup();

    await expect(controller.create(request(), TRACKER, RECORD, { body: '' })).rejects.toBeTruthy();
    expect(comments.create).not.toHaveBeenCalled();

    await controller.create(request(), TRACKER, RECORD, { body: 'New' });
    const created = comments.create.mock.calls[0]?.[3] as { body: string };
    expect(created.body).toBe('New');
  });
});
