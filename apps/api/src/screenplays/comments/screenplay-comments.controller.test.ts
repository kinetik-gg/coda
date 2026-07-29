import { describe, expect, it, vi } from 'vitest';
import { ScreenplayCommentsController } from './screenplay-comments.controller';

const request = { user: { id: 'user-id' } } as never;
const screenplayId = 'screenplay-id';

describe('ScreenplayCommentsController', () => {
  it('validates and forwards thread filters', async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'thread-id' }]);
    const controller = new ScreenplayCommentsController({ list } as never);

    await expect(controller.list(request, screenplayId, {})).resolves.toEqual({
      data: [{ id: 'thread-id' }],
    });
    expect(list).toHaveBeenCalledWith('user-id', screenplayId, { status: 'open' });

    await controller.list(request, screenplayId, { status: 'all' });
    expect(list).toHaveBeenLastCalledWith('user-id', screenplayId, { status: 'all' });
    await expect(controller.list(request, screenplayId, { status: 'invalid' })).rejects.toThrow();
  });

  it('validates encoded anchors and creates a trimmed initial comment', async () => {
    const createThread = vi.fn().mockResolvedValue({ id: 'thread-id' });
    const controller = new ScreenplayCommentsController({ createThread } as never);

    await expect(
      controller.createThread(request, screenplayId, {
        anchorStart: 'AQID',
        anchorEnd: 'BAUG',
        quotedText: 'Selection',
        body: '  A note  ',
      }),
    ).resolves.toEqual({ data: { id: 'thread-id' } });
    expect(createThread).toHaveBeenCalledWith('user-id', screenplayId, {
      anchorStart: 'AQID',
      anchorEnd: 'BAUG',
      quotedText: 'Selection',
      body: 'A note',
    });

    await expect(
      controller.createThread(request, screenplayId, {
        anchorStart: 'invalid anchor',
        anchorEnd: 'BAUG',
        quotedText: 'Selection',
        body: 'A note',
      }),
    ).rejects.toThrow();
  });

  it('forwards validated replies and comment edits', async () => {
    const reply = vi.fn().mockResolvedValue({ id: 'reply-id' });
    const updateComment = vi.fn().mockResolvedValue({ id: 'comment-id', body: 'Edited' });
    const controller = new ScreenplayCommentsController({
      reply,
      updateComment,
    } as never);

    await expect(
      controller.reply(request, screenplayId, 'thread-id', { body: '  Reply  ' }),
    ).resolves.toEqual({ data: { id: 'reply-id' } });
    expect(reply).toHaveBeenCalledWith('user-id', screenplayId, 'thread-id', 'Reply');

    await expect(
      controller.updateComment(request, screenplayId, 'comment-id', { body: ' Edited ' }),
    ).resolves.toEqual({ data: { id: 'comment-id', body: 'Edited' } });
    expect(updateComment).toHaveBeenCalledWith('user-id', screenplayId, 'comment-id', 'Edited');
    await expect(
      controller.reply(request, screenplayId, 'thread-id', { body: ' ' }),
    ).rejects.toThrow();
  });

  it('forwards resolution and deletion intent', async () => {
    const setResolved = vi.fn().mockResolvedValue({ id: 'thread-id', status: 'RESOLVED' });
    const deleteComment = vi.fn().mockResolvedValue({ id: 'comment-id', deletedAt: 'now' });
    const controller = new ScreenplayCommentsController({
      setResolved,
      deleteComment,
    } as never);

    await expect(
      controller.resolve(request, screenplayId, 'thread-id', { resolved: true }),
    ).resolves.toEqual({ data: { id: 'thread-id', status: 'RESOLVED' } });
    expect(setResolved).toHaveBeenCalledWith('user-id', screenplayId, 'thread-id', true);

    await expect(controller.deleteComment(request, screenplayId, 'comment-id')).resolves.toEqual({
      data: { id: 'comment-id', deletedAt: 'now' },
    });
    expect(deleteComment).toHaveBeenCalledWith('user-id', screenplayId, 'comment-id');
    await expect(
      controller.resolve(request, screenplayId, 'thread-id', { resolved: 'yes' }),
    ).rejects.toThrow();
  });
});
