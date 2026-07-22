import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { StorageController } from './storage.controller';

const projectId = '11111111-1111-4111-8111-111111111111';
const storageObjectId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';

describe('StorageController route behavior', () => {
  it('delegates write-once upload creation/completion and invalidates after persistence', async () => {
    const storage = {
      createUpload: vi.fn().mockResolvedValue({ id: storageObjectId }),
      completeUpload: vi.fn().mockResolvedValue({ id: storageObjectId, status: 'READY' }),
      readUrl: vi.fn().mockResolvedValue({ url: 'https://objects.test/signed' }),
    };
    const documents = {
      create: vi.fn().mockResolvedValue({ id: documentId }),
      addReference: vi.fn().mockResolvedValue({ id: 'reference-1' }),
    };
    const realtime = { invalidateProject: vi.fn().mockResolvedValue(undefined) };
    const controller = new StorageController(
      storage as never,
      documents as never,
      realtime as never,
    );
    const request = { user: { id: 'user-1' } } as Request;

    await controller.create(request, {
      projectId,
      kind: 'file',
      filename: 'asset.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 10,
    });
    await controller.complete(request, projectId, storageObjectId, { version: 1 });
    await controller.content(request, projectId, storageObjectId);
    await controller.document(request, projectId, {
      storageObjectId,
      title: 'Source PDF',
    });
    await controller.reference(request, projectId, 'item-1', {
      sourceDocumentId: documentId,
      startPage: 1,
      endPage: 2,
    });

    expect(storage.createUpload).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ projectId, filename: 'asset.bin' }),
    );
    expect(storage.completeUpload).toHaveBeenCalledWith('user-1', projectId, storageObjectId, 1);
    expect(realtime.invalidateProject).toHaveBeenCalledTimes(4);
  });
});
