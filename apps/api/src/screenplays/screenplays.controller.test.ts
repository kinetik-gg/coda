import { describe, expect, it, vi } from 'vitest';
import { ScreenplaysController } from './screenplays.controller';

describe('ScreenplaysController', () => {
  it('exports the exact Fountain source as an attachment', async () => {
    const sourceText = 'Title: Pilot\r\n\r\nINT. ROOM - DAY\r\n';
    const get = vi.fn().mockResolvedValue({
      id: 'screenplay-id',
      filename: 'Pilot Draft.fountain',
      sourceText,
    });
    const controller = new ScreenplaysController({ get } as never);
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
    const controller = new ScreenplaysController({ checkpoint } as never);

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
    const controller = new ScreenplaysController({ getCheckpointExport } as never);
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
});
