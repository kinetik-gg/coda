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
});
