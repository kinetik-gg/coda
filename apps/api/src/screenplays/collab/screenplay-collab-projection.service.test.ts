import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { SCREENPLAY_COLLAB_TEXT_KEY } from './screenplay-collab.constants';
import { ScreenplayCollabProjectionService } from './screenplay-collab-projection.service';

const limits = {
  maxDocumentsPerOwner: 20,
  maxSourceBytesPerOwner: 1_000_000,
  maxCheckpointsPerScreenplay: 100,
  maxCheckpointBytesPerOwner: 1_000_000,
};

function collaborationHistory() {
  const checkpointDoc = new Y.Doc();
  checkpointDoc.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, 'FADE IN:');
  const checkpointPayload = Y.encodeStateAsUpdate(checkpointDoc);
  const checkpointVector = Y.encodeStateVector(checkpointDoc);
  const continued = new Y.Doc();
  Y.applyUpdate(continued, checkpointPayload);
  continued
    .getText(SCREENPLAY_COLLAB_TEXT_KEY)
    .insert(continued.getText('source').length, '\nCUT TO:');
  const updatePayload = Y.encodeStateAsUpdate(continued, checkpointVector);
  checkpointDoc.destroy();
  continued.destroy();
  return { checkpointPayload, updatePayload };
}

function projectionHarness(currentSource = 'FADE IN:') {
  const history = collaborationHistory();
  const transaction = {
    screenplay: {
      findFirst: vi.fn().mockResolvedValue({
        ownerUserId: 'owner-id',
        sourceText: currentSource,
        sourceByteLength: Buffer.byteLength(currentSource),
        version: 4,
      }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 200 } }),
      update: vi.fn().mockResolvedValue({ version: 5 }),
    },
  };
  const prisma = {
    screenplayCollabCheckpoint: {
      findUnique: vi.fn().mockResolvedValue({
        throughSeq: 7,
        payload: history.checkpointPayload,
      }),
    },
    screenplayCollabUpdate: {
      findMany: vi.fn().mockResolvedValue([{ payload: history.updatePayload }]),
    },
    $transaction: vi.fn((operation: (client: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
  const service = new ScreenplayCollabProjectionService(prisma as never, limits);
  return { prisma, service, transaction };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ScreenplayCollabProjectionService projection', () => {
  it('replays the checkpoint and log into the canonical Fountain source', async () => {
    const { service, transaction } = projectionHarness();

    await expect(service.project('screenplay-id')).resolves.toBe(5);

    expect(transaction.screenplay.update).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', version: 4, deletedAt: null },
      data: {
        sourceText: 'FADE IN:\nCUT TO:',
        sourceByteLength: Buffer.byteLength('FADE IN:\nCUT TO:'),
        version: { increment: 1 },
      },
      select: { version: true },
    });
  });

  it('does not bump the screenplay version when the projection is already current', async () => {
    const { service, transaction } = projectionHarness('FADE IN:\nCUT TO:');

    await expect(service.project('screenplay-id')).resolves.toBe(4);

    expect(transaction.screenplay.aggregate).not.toHaveBeenCalled();
    expect(transaction.screenplay.update).not.toHaveBeenCalled();
  });

  it('enforces the existing per-owner source quota', async () => {
    const { service, transaction } = projectionHarness();
    transaction.screenplay.aggregate.mockResolvedValue({
      _sum: { sourceByteLength: limits.maxSourceBytesPerOwner },
    });

    await expect(service.project('screenplay-id')).rejects.toBeInstanceOf(HttpException);
    expect(transaction.screenplay.update).not.toHaveBeenCalled();
  });
});

describe('ScreenplayCollabProjectionService debounce', () => {
  it('coalesces activity for one screenplay onto the 700 ms projection cadence', async () => {
    vi.useFakeTimers();
    const { service } = projectionHarness();
    const project = vi.spyOn(service, 'project').mockResolvedValue(5);

    service.schedule('screenplay-id');
    await vi.advanceTimersByTimeAsync(500);
    service.schedule('screenplay-id');
    await vi.advanceTimersByTimeAsync(699);
    expect(project).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(project).toHaveBeenCalledOnce();
    expect(project).toHaveBeenCalledWith('screenplay-id');
    service.onModuleDestroy();
  });
});
