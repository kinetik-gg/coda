import { describe, expect, it, vi } from 'vitest';
import { ScreenplaysController } from './screenplays.controller';

describe('ScreenplaysController', () => {
  it('validates and forwards an optional Space filter without changing the envelope', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const controller = new ScreenplaysController({ list } as never, {} as never);
    const spaceId = '10000000-0000-4000-8000-000000000003';

    await expect(controller.list({ user: { id: 'user' } } as never, { spaceId })).resolves.toEqual({
      data: [],
      meta: { nextCursor: null },
    });
    expect(list).toHaveBeenCalledWith('user', { spaceId, limit: 50 });
    await expect(
      controller.list({ user: { id: 'user' } } as never, { spaceId: 'invalid' }),
    ).rejects.toThrow();
  });

  it('exports the exact Fountain source as an attachment', async () => {
    const sourceText = 'Title: Pilot\r\n\r\nINT. ROOM - DAY\r\n';
    const get = vi.fn().mockResolvedValue({
      id: 'screenplay-id',
      filename: 'Pilot Draft.fountain',
      sourceText,
    });
    const controller = new ScreenplaysController({ get } as never, {} as never);
    const type = vi.fn();
    const setHeader = vi.fn();

    await expect(
      controller.exportFountain({ user: { id: 'owner-id' } } as never, 'screenplay-id', {
        type,
        setHeader,
      } as never),
    ).resolves.toBe(sourceText);
    expect(type).toHaveBeenCalledWith('text/plain; charset=utf-8');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="Pilot Draft.fountain"',
    );
  });

  it('creates a checkpoint with the expected screenplay version', async () => {
    const checkpoint = vi.fn().mockResolvedValue({ id: 'checkpoint-id', screenplayVersion: 4 });
    const controller = new ScreenplaysController({ checkpoint } as never, {} as never);

    await expect(
      controller.checkpoint({ user: { id: 'owner-id' } } as never, 'screenplay-id', { version: 4 }),
    ).resolves.toEqual({ data: { id: 'checkpoint-id', screenplayVersion: 4 } });
    expect(checkpoint).toHaveBeenCalledWith('owner-id', 'screenplay-id', { version: 4 });
  });

  it('exports exact checkpoint source with its snapshotted filename', async () => {
    const sourceText = '\uFEFFTitle: Exact\r\n\r\nINT. CAFÉ - DAY\r\n';
    const getCheckpointExport = vi.fn().mockResolvedValue({
      filename: 'Exact Draft.fountain',
      sourceText,
    });
    const controller = new ScreenplaysController({ getCheckpointExport } as never, {} as never);
    const type = vi.fn();
    const setHeader = vi.fn();

    await expect(
      controller.exportCheckpointFountain(
        { user: { id: 'owner-id' } } as never,
        'screenplay-id',
        'checkpoint-id',
        { type, setHeader } as never,
      ),
    ).resolves.toBe(sourceText);
    expect(getCheckpointExport).toHaveBeenCalledWith('owner-id', 'screenplay-id', 'checkpoint-id');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="Exact Draft.fountain"',
    );
  });

  it('soft-deletes a screenplay through the trash service', async () => {
    const trashScreenplay = vi.fn().mockResolvedValue({ id: 'screenplay-id', deletedAt: 'now' });
    const controller = new ScreenplaysController({} as never, { trashScreenplay } as never);

    await expect(
      controller.trashScreenplay({ user: { id: 'owner-id' } } as never, 'screenplay-id'),
    ).resolves.toEqual({ data: { id: 'screenplay-id', deletedAt: 'now' } });
    expect(trashScreenplay).toHaveBeenCalledWith('owner-id', 'screenplay-id');
  });

  it('restores a trashed screenplay through the trash service', async () => {
    const restoreScreenplay = vi.fn().mockResolvedValue({ id: 'screenplay-id', deletedAt: null });
    const controller = new ScreenplaysController({} as never, { restoreScreenplay } as never);

    await expect(
      controller.restore({ user: { id: 'owner-id' } } as never, 'screenplay-id'),
    ).resolves.toEqual({ data: { id: 'screenplay-id', deletedAt: null } });
    expect(restoreScreenplay).toHaveBeenCalledWith('owner-id', 'screenplay-id');
  });

  it('purges a trashed screenplay through the trash service', async () => {
    const purgeScreenplay = vi.fn().mockResolvedValue({ purged: true });
    const controller = new ScreenplaysController({} as never, { purgeScreenplay } as never);

    await expect(
      controller.purge({ user: { id: 'owner-id' } } as never, 'screenplay-id'),
    ).resolves.toEqual({ data: { purged: true } });
    expect(purgeScreenplay).toHaveBeenCalledWith('owner-id', 'screenplay-id');
  });

  it('lists trashed screenplays through the trash service', async () => {
    const listTrashedScreenplays = vi.fn().mockResolvedValue([{ id: 'screenplay-id' }]);
    const controller = new ScreenplaysController({} as never, { listTrashedScreenplays } as never);

    await expect(controller.listTrash({ user: { id: 'owner-id' } } as never)).resolves.toEqual({
      data: [{ id: 'screenplay-id' }],
    });
    expect(listTrashedScreenplays).toHaveBeenCalledWith('owner-id');
  });
});
