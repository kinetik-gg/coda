import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService } from './documents.service';

function serviceWith(prisma: object) {
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const storage = {
    withPdfInspectionSlot: vi.fn((operation: () => unknown) => operation()),
    pdfPageCount: vi.fn().mockResolvedValue(12),
  };
  return {
    service: new DocumentsService(prisma as never, permissions as never, storage as never),
    permissions,
  };
}

describe('DocumentsService defensive lifecycle coverage', () => {
  it('requires a ready source-document storage object from the same project', async () => {
    const { service } = serviceWith({
      storageObject: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.create('user', 'project', { storageObjectId: 'missing', title: 'Script' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a storage object already linked to another project', async () => {
    const { service } = serviceWith({
      storageObject: { findFirst: vi.fn().mockResolvedValue({ id: 'storage' }) },
      sourceDocument: {
        findUnique: vi.fn().mockResolvedValue({ id: 'document', projectId: 'other' }),
      },
    });
    await expect(
      service.create('user', 'project', { storageObjectId: 'storage', title: 'Script' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds a ranked page reference after validating item and document ownership', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'reference' });
    const { service, permissions } = serviceWith({
      breakdownItem: { findFirst: vi.fn().mockResolvedValue({ id: 'item' }) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue({ id: 'document', pageCount: 10 }) },
      itemSourceReference: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    });
    await expect(
      service.addReference('user', 'project', 'item', {
        sourceDocumentId: 'document',
        startPage: 2,
        endPage: 4,
      }),
    ).resolves.toEqual({ id: 'reference' });
    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'manage_items');
    const createCall = create.mock.calls[0]?.[0] as unknown as {
      data: { itemId: string; sourceDocumentId: string; position: string };
    };
    expect(createCall.data).toMatchObject({ itemId: 'item', sourceDocumentId: 'document' });
    expect(createCall.data.position).toEqual(expect.any(String));
  });

  it('rejects missing records and page ranges beyond the document', async () => {
    const missing = serviceWith({
      breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue(null) },
      itemSourceReference: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      missing.service.addReference('user', 'project', 'item', {
        sourceDocumentId: 'document',
        startPage: 1,
        endPage: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const tooLong = serviceWith({
      breakdownItem: { findFirst: vi.fn().mockResolvedValue({ id: 'item' }) },
      sourceDocument: { findFirst: vi.fn().mockResolvedValue({ id: 'document', pageCount: 3 }) },
      itemSourceReference: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      tooLong.service.addReference('user', 'project', 'item', {
        sourceDocumentId: 'document',
        startPage: 1,
        endPage: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
