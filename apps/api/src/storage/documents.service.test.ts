import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService } from './documents.service';

function serviceWith(prisma: object) {
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const storage = {
    withPdfInspectionSlot: vi.fn((operation: () => unknown) => operation()),
    pdfPageCount: vi.fn().mockResolvedValue(12),
  };
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

  it('shares one costly inspection across duplicate project and object requests', async () => {
    let resolvePageCount!: (pageCount: number) => void;
    const pageCount = new Promise<number>((resolve) => {
      resolvePageCount = resolve;
    });
    const pdfPageCount = vi.fn().mockReturnValue(pageCount);
    const withPdfInspectionSlot = vi.fn((operation: () => unknown) => operation());
    const document = { id: 'document-1', projectId: 'project-1', pageCount: 12 };
    const prisma = {
      storageObject: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'storage-1',
          objectKey: 'project-1/source',
          sizeBytes: 10n,
        }),
      },
      sourceDocument: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(document),
      },
    };
    const service = new DocumentsService(
      prisma as never,
      { assert: vi.fn().mockResolvedValue({}) } as never,
      { withPdfInspectionSlot, pdfPageCount } as never,
    );

    const first = service.create('user-1', 'project-1', {
      storageObjectId: 'storage-1',
      title: 'Source',
    });
    const duplicate = service.create('user-1', 'project-1', {
      storageObjectId: 'storage-1',
      title: 'Duplicate request',
    });
    await vi.waitFor(() => expect(pdfPageCount).toHaveBeenCalledOnce());
    expect(withPdfInspectionSlot).toHaveBeenCalledOnce();
    resolvePageCount(12);

    await expect(Promise.all([first, duplicate])).resolves.toEqual([document, document]);
    expect(prisma.sourceDocument.create).toHaveBeenCalledOnce();
  });

  it('rechecks the ready object after queue admission before inspecting bytes', async () => {
    let admit!: () => void;
    const withPdfInspectionSlot = vi.fn(
      (operation: () => unknown) =>
        new Promise((resolve, reject) => {
          admit = () => {
            void Promise.resolve(operation()).then(resolve, reject);
          };
        }),
    );
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'storage-1',
        objectKey: 'project-1/source',
        sizeBytes: 10n,
      })
      .mockResolvedValueOnce(null);
    const pdfPageCount = vi.fn();
    const service = new DocumentsService(
      { storageObject: { findFirst } } as never,
      { assert: vi.fn().mockResolvedValue({}) } as never,
      { withPdfInspectionSlot, pdfPageCount } as never,
    );

    const creation = service.create('user-1', 'project-1', {
      storageObjectId: 'storage-1',
      title: 'Source',
    });
    await vi.waitFor(() => expect(withPdfInspectionSlot).toHaveBeenCalledOnce());
    expect(findFirst).toHaveBeenCalledOnce();
    admit();

    await expect(creation).rejects.toThrow('A ready PDF storage object is required');
    expect(pdfPageCount).not.toHaveBeenCalled();
  });
});
