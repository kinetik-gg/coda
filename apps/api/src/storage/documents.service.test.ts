import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService } from './documents.service';

function serviceWith(prisma: object) {
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const storage = { pdfPageCount: vi.fn().mockResolvedValue(12) };
  return new DocumentsService(prisma as never, permissions as never, storage as never);
}

describe('DocumentsService source PDF invariant', () => {
  it('rejects a second active source PDF for the same project', async () => {
    const create = vi.fn();
    const service = serviceWith({
      storageObject: {
        findFirst: vi.fn().mockResolvedValue({ id: 'storage-2' }),
      },
      sourceDocument: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: 'document-1' }),
        create,
      },
    });

    await expect(
      service.create('user-1', 'project-1', {
        storageObjectId: 'storage-2',
        title: 'Second source',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps registration idempotent for the already-linked storage object', async () => {
    const linked = { id: 'document-1', projectId: 'project-1' };
    const findFirst = vi.fn();
    const service = serviceWith({
      storageObject: {
        findFirst: vi.fn().mockResolvedValue({ id: 'storage-1' }),
      },
      sourceDocument: {
        findUnique: vi.fn().mockResolvedValue(linked),
        findFirst,
      },
    });

    await expect(
      service.create('user-1', 'project-1', {
        storageObjectId: 'storage-1',
        title: 'Existing source',
      }),
    ).resolves.toBe(linked);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('persists the authoritative server-read page count', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'document-1', pageCount: 12 });
    const service = serviceWith({
      storageObject: {
        findFirst: vi.fn().mockResolvedValue({ id: 'storage-1', objectKey: 'project/source' }),
      },
      sourceDocument: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    });

    await service.create('user-1', 'project-1', {
      storageObjectId: 'storage-1',
      title: 'Source',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        storageObjectId: 'storage-1',
        title: 'Source',
        pageCount: 12,
      },
      include: { storageObject: true },
    });
  });
});
