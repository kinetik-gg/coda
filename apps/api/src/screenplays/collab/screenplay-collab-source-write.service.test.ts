import { describe, expect, it, vi } from 'vitest';
import { ScreenplayCollabSourceWriteService } from './screenplay-collab-source-write.service';

function harness(rewritten: Uint8Array | undefined, projectedVersion: number | null = 7) {
  const log = {
    hasDocument: vi.fn().mockResolvedValue(true),
    rewriteSourceText: vi.fn().mockResolvedValue(rewritten),
  };
  const projection = {
    cancel: vi.fn(),
    project: vi.fn().mockResolvedValue(projectedVersion ?? undefined),
  };
  const realtime = {
    broadcastScreenplayUpdate: vi.fn(),
    broadcastProjection: vi.fn(),
  };
  const target = new ScreenplayCollabSourceWriteService(
    log as never,
    projection as never,
    realtime as never,
  );
  return { log, projection, realtime, target };
}

describe('ScreenplayCollabSourceWriteService', () => {
  it('writes the text into the log, relays it, and re-derives the projection from that log', async () => {
    const update = Uint8Array.of(1, 2, 3);
    const { log, projection, realtime, target } = harness(update);

    await expect(target.applySourceText('screenplay-id', 'author-id', 'FADE IN:\n')).resolves.toBe(
      7,
    );

    expect(log.rewriteSourceText).toHaveBeenCalledWith('screenplay-id', 'author-id', 'FADE IN:\n');
    expect(realtime.broadcastScreenplayUpdate).toHaveBeenCalledWith('screenplay-id', update);
    // The debounced projection this write would race is dropped, then run to completion, so the
    // caller's response carries a `sourceText` that is a function of the log it just appended to.
    expect(projection.cancel).toHaveBeenCalledWith('screenplay-id');
    expect(projection.project).toHaveBeenCalledWith('screenplay-id');
    expect(realtime.broadcastProjection).toHaveBeenCalledWith({
      screenplayId: 'screenplay-id',
      version: 7,
    });
  });

  it('still projects when the document already held the requested text', async () => {
    const { projection, realtime, target } = harness(undefined);

    await expect(target.applySourceText('screenplay-id', 'author-id', 'FADE IN:\n')).resolves.toBe(
      7,
    );

    expect(realtime.broadcastScreenplayUpdate).not.toHaveBeenCalled();
    expect(projection.project).toHaveBeenCalledWith('screenplay-id');
  });

  it('announces nothing when the screenplay was trashed underneath the write', async () => {
    const { realtime, target } = harness(Uint8Array.of(9), null);

    await expect(
      target.applySourceText('screenplay-id', 'author-id', 'FADE IN:\n'),
    ).resolves.toBeUndefined();
    expect(realtime.broadcastProjection).not.toHaveBeenCalled();
  });

  it('delegates the authority question to the log', async () => {
    const { log, target } = harness(undefined);

    await expect(target.hasDocument('screenplay-id')).resolves.toBe(true);
    expect(log.hasDocument).toHaveBeenCalledWith('screenplay-id');
  });
});
