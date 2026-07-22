import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  signedUrl: vi.fn().mockResolvedValue('https://objects.test/signed'),
  workerOptions: vi.fn(),
  workerTerminate: vi.fn().mockResolvedValue(0),
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
    PDF_WORKER_MAX_OLD_GENERATION_MB: 64,
    ASSET_MAX_BYTES: 200,
    STORAGE_PENDING_MAX_OBJECTS: 20,
    STORAGE_PENDING_MAX_BYTES: 1_000,
    STORAGE_PENDING_INSTANCE_MAX_OBJECTS: 100,
    STORAGE_PENDING_INSTANCE_MAX_BYTES: 10_000,
    STORAGE_UPLOAD_RETENTION_HOURS: 24,
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

vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor(_filename: string, options: unknown) {
      mocks.workerOptions(options);
    }

    once(event: string, handler: (value: unknown) => void) {
      if (event === 'message') queueMicrotask(() => handler({ pageCount: 3 }));
      return this;
    }

    terminate(): Promise<number> {
      mocks.workerTerminate();
      return Promise.resolve(0);
    }
  },
}));

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
    project: { findFirst: vi.fn().mockResolvedValue({ id: 'project-1' }) },
    storageObject: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } }),
      create: vi.fn().mockResolvedValue(baseObject),
      findFirst: vi.fn().mockResolvedValue(baseObject),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...baseObject, ...data, version: 2 }),
        ),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    ...prismaOverrides,
  };
  Reflect.set(
    prisma,
    '$transaction',
    vi.fn((callback: (tx: typeof prisma) => unknown) => callback(prisma)),
  );
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
    mocks.workerOptions.mockClear();
    mocks.workerTerminate.mockClear();
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

    prisma.storageObject.count.mockResolvedValueOnce(1);
    await expect(
      service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'source_document',
        filename: 'source.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.storageObject.count).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        kind: 'SOURCE_DOCUMENT',
        status: { in: ['PENDING', 'READY'] },
        deletedAt: null,
      },
    });

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
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.project.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(prisma.project.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$executeRaw.mock.invocationCallOrder[1]!,
    );
    expect(prisma.storageObject.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signedUrl.mock.invocationCallOrder[0]!,
    );
  });

  it('rechecks the active project under the lifecycle lock before reserving or signing', async () => {
    const { service, prisma } = serviceWith();
    prisma.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'file',
        filename: 'asset.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it('serializes and caps incomplete upload reservations per project and instance', async () => {
    const countLimited = serviceWith();
    countLimited.prisma.storageObject.aggregate.mockResolvedValueOnce({
      _count: { id: 20 },
      _sum: { sizeBytes: 100n },
    });
    await expect(
      countLimited.service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'file',
        filename: 'asset.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const byteLimited = serviceWith();
    byteLimited.prisma.storageObject.aggregate.mockResolvedValueOnce({
      _count: { id: 1 },
      _sum: { sizeBytes: 995n },
    });
    await expect(
      byteLimited.service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'file',
        filename: 'asset.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(byteLimited.prisma.storageObject.create).not.toHaveBeenCalled();

    const instanceLimited = serviceWith();
    instanceLimited.prisma.storageObject.aggregate
      .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { sizeBytes: null } })
      .mockResolvedValueOnce({ _count: { id: 100 }, _sum: { sizeBytes: 1_000n } });
    await expect(
      instanceLimited.service.createUpload('user-1', {
        projectId: 'project-1',
        kind: 'file',
        filename: 'asset.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
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

  it('transfers PDF bytes to a heap-limited worker without copying the full buffer', async () => {
    const { service } = serviceWith();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mocks.send.mockResolvedValueOnce({
      Body: { transformToByteArray: vi.fn().mockResolvedValue(bytes) },
    });

    await expect(service.pdfPageCount('object', bytes.byteLength)).resolves.toBe(3);
    const options = mocks.workerOptions.mock.calls[0]?.[0] as {
      workerData: ArrayBuffer;
      transferList: ArrayBuffer[];
      resourceLimits: Record<string, number>;
    };
    expect(options.workerData).toBe(bytes.buffer);
    expect(options.transferList).toEqual([bytes.buffer]);
    expect(options.resourceLimits).toEqual({
      maxOldGenerationSizeMb: 64,
      maxYoungGenerationSizeMb: 32,
      stackSizeMb: 4,
    });
  });

  it('bounds active and queued PDF inspections and recovers capacity', async () => {
    const { service } = serviceWith();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const admitted = Array.from({ length: 4 }, () =>
      service.withPdfInspectionSlot(async () => {
        started += 1;
        await gate;
      }),
    );
    await vi.waitFor(() => expect(started).toBe(1));

    await expect(service.withPdfInspectionSlot(() => Promise.resolve())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    release();
    await Promise.all(admitted);
    expect(started).toBe(4);
    await expect(service.withPdfInspectionSlot(() => Promise.resolve('available'))).resolves.toBe(
      'available',
    );
  });
});
