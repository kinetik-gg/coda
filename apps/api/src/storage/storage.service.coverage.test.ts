import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  signedUrl: vi.fn().mockResolvedValue('https://objects.test/signed'),
}));

vi.mock('../config/env', () => ({
  env: () => ({
    APP_ORIGIN: 'http://app.test',
    S3_ENDPOINT: 'http://storage.internal',
    S3_PUBLIC_ENDPOINT: 'http://objects.test',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret-key',
    S3_FORCE_PATH_STYLE: true,
    PDF_MAX_BYTES: 100,
    ASSET_MAX_BYTES: 200,
    SIGNED_READ_TTL_SECONDS: 300,
    SIGNED_UPLOAD_TTL_SECONDS: 900,
  }),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    S3Client: class {
      send = mocks.send;
    },
    CreateBucketCommand: Command,
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    HeadBucketCommand: Command,
    HeadObjectCommand: Command,
    PutObjectCommand: Command,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.signedUrl }));

import { StorageService } from './storage.service';

const baseObject = {
  id: 'storage-1',
  projectId: 'project-1',
  kind: 'FILE',
  objectKey: 'project-1/object',
  originalFilename: 'asset.bin',
  mimeType: 'application/octet-stream',
  sizeBytes: 10n,
  status: 'PENDING',
  version: 1,
  deletedAt: null,
};

function serviceWith(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    sourceDocument: { count: vi.fn().mockResolvedValue(0) },
    storageObject: {
      create: vi.fn().mockResolvedValue(baseObject),
      findFirst: vi.fn().mockResolvedValue(baseObject),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...baseObject, ...data, version: 2 }),
        ),
    },
    ...prismaOverrides,
  };
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  return {
    prisma,
    permissions,
    service: new StorageService(prisma as never, permissions as never),
  };
}

describe('StorageService object lifecycle', () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.signedUrl.mockClear();
  });

  it('creates the bucket only when readiness probing fails', async () => {
    const { service } = serviceWith();
    mocks.send.mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce({});
    await service.onModuleInit();
    expect(mocks.send).toHaveBeenCalledTimes(2);

    mocks.send.mockResolvedValueOnce({});
    await service.ready();
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it('validates source-document type, uniqueness, and package size before creating uploads', async () => {
    const { service, prisma } = serviceWith();
    await expect(
      service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'source_document',
        filename: 'source.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.sourceDocument.count.mockResolvedValueOnce(1);
    await expect(
      service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'source_document',
        filename: 'source.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'file',
        filename: 'large.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 201,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists upload metadata and returns a bounded signed URL', async () => {
    const { service, prisma, permissions } = serviceWith();
    const result = await service.createUpload('user-1', {
      projectId: 'project-1',
      kind: 'file',
      filename: 'asset.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 10,
    });

    expect(permissions.assert).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'manage_storage_objects',
    );
    const createInput = prisma.storageObject.create.mock.calls[0]?.[0] as unknown as {
      data: { projectId: string; kind: string; sizeBytes: bigint };
    };
    expect(createInput.data).toMatchObject({
      projectId: 'project-1',
      kind: 'FILE',
      sizeBytes: 10n,
    });
    expect(result).toMatchObject({ id: 'storage-1', sizeBytes: 10 });
    expect(typeof result.uploadUrl).toBe('string');
    const signedCommand = mocks.signedUrl.mock.calls[0]?.[1] as unknown as {
      input: { IfNoneMatch?: string };
    };
    expect(signedCommand.input.IfNoneMatch).toBe('*');
  });

  it('rejects missing, stale, and metadata-mismatched completion requests', async () => {
    const missing = serviceWith();
    missing.prisma.storageObject.findFirst.mockResolvedValueOnce(null);
    await expect(
      missing.service.completeUpload('user-1', 'project-1', 'missing', 1),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stale = serviceWith();
    await expect(
      stale.service.completeUpload('user-1', 'project-1', 'storage-1', 2),
    ).rejects.toBeInstanceOf(BadRequestException);

    const mismatched = serviceWith();
    mocks.send.mockResolvedValueOnce({ ContentLength: 9, ContentType: 'text/plain' });
    await expect(
      mismatched.service.completeUpload('user-1', 'project-1', 'storage-1', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mismatched.prisma.storageObject.update).toHaveBeenCalledWith({
      where: { id: 'storage-1' },
      data: { status: 'FAILED', version: { increment: 1 } },
    });
  });

  it('verifies PDF signatures and completes valid source documents', async () => {
    const pdfObject = {
      ...baseObject,
      kind: 'SOURCE_DOCUMENT',
      originalFilename: 'source.pdf',
      mimeType: 'application/pdf',
    };
    const invalid = serviceWith();
    invalid.prisma.storageObject.findFirst.mockResolvedValueOnce(pdfObject);
    mocks.send
      .mockResolvedValueOnce({ ContentLength: 10, ContentType: 'application/pdf' })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(Buffer.from('wrong')) },
      });
    await expect(
      invalid.service.completeUpload('user-1', 'project-1', 'storage-1', 1),
    ).rejects.toBeInstanceOf(BadRequestException);

    const valid = serviceWith();
    valid.prisma.storageObject.findFirst.mockResolvedValueOnce(pdfObject);
    valid.prisma.storageObject.update.mockResolvedValueOnce({
      ...pdfObject,
      status: 'READY',
      version: 2,
    });
    mocks.send
      .mockResolvedValueOnce({ ContentLength: 10, ContentType: 'application/pdf' })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn().mockResolvedValue(Buffer.from('%PDF-')) },
      });
    await expect(
      valid.service.completeUpload('user-1', 'project-1', 'storage-1', 1),
    ).resolves.toMatchObject({ status: 'READY', sizeBytes: 10 });
  });

  it('builds inline and attachment read URLs and rejects absent objects', async () => {
    const missing = serviceWith();
    missing.prisma.storageObject.findFirst.mockResolvedValueOnce(null);
    await expect(missing.service.readUrl('user-1', 'project-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const file = serviceWith();
    await expect(file.service.readUrl('user-1', 'project-1', 'storage-1')).resolves.toEqual({
      url: 'https://objects.test/signed',
      expiresIn: 300,
    });

    const pdf = serviceWith();
    pdf.prisma.storageObject.findFirst.mockResolvedValueOnce({
      ...baseObject,
      kind: 'SOURCE_DOCUMENT',
      originalFilename: 'source name.pdf',
    });
    await pdf.service.readUrl('user-1', 'project-1', 'storage-1');
    expect(mocks.signedUrl).toHaveBeenCalledTimes(2);
  });

  it('bounds PDF inspection input and exposes safe serialization/deletion helpers', async () => {
    const { service } = serviceWith();
    await expect(service.pdfPageCount('object', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.pdfPageCount('object', 101)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.serialize({ id: 'one', sizeBytes: 15n })).toEqual({ id: 'one', sizeBytes: 15 });
    mocks.send.mockResolvedValueOnce({});
    await service.deletePhysical('object');
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
