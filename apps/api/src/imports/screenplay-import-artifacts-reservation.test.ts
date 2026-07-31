import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayImportArtifactsService } from './screenplay-import-artifacts.service';

/**
 * Reservation limits are asserted against fixed values rather than the real
 * environment so the suite never depends on deployment configuration.
 */
const limits = vi.hoisted(() => ({
  ASSET_MAX_BYTES: 200,
  STORAGE_PENDING_MAX_OBJECTS: 20,
  STORAGE_PENDING_MAX_BYTES: 1_000,
  STORAGE_PENDING_INSTANCE_MAX_OBJECTS: 100,
  STORAGE_PENDING_INSTANCE_MAX_BYTES: 10_000,
}));

vi.mock('../config/env', () => ({ env: () => limits }));

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    screenplayId: '10000000-0000-4000-8000-000000000002',
    createdByUserId: '10000000-0000-4000-8000-000000000003',
    status: 'PENDING',
    objectKey: 'screenplay-imports/10000000-0000-4000-8000-000000000002/artifact/original',
    originalFilename: 'pilot.docx',
    mimeType: 'application/docx',
    sizeBytes: 42n,
    sourceFormat: 'docx',
    convertedFountain: null,
    reportSchemaVersion: null,
    conversionReport: null,
    version: 1,
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

const input = {
  originalFilename: 'pilot.docx',
  mimeType: 'application/docx',
  sizeBytes: 42,
  sourceFormat: 'docx',
};

function harness(
  options: {
    screenplayUsage?: { count: number; bytes: bigint };
    instanceUsage?: { count: number; bytes: bigint };
    storageUsage?: { count: number; bytes: bigint };
    uploadError?: Error;
  } = {},
) {
  const reserved = artifact();
  const aggregate = vi.fn((query: { where: { screenplayId?: string } }) => {
    const usage = query.where.screenplayId
      ? (options.screenplayUsage ?? { count: 0, bytes: 0n })
      : (options.instanceUsage ?? { count: 0, bytes: 0n });
    return Promise.resolve({ _count: { id: usage.count }, _sum: { sizeBytes: usage.bytes } });
  });
  const tx = {
    screenplay: { findFirst: vi.fn().mockResolvedValue({ id: reserved.screenplayId }) },
    screenplayImportArtifact: {
      aggregate,
      create: vi.fn().mockResolvedValue(reserved),
    },
    storageObject: {
      aggregate: vi.fn().mockResolvedValue({
        _count: { id: options.storageUsage?.count ?? 0 },
        _sum: { sizeBytes: options.storageUsage?.bytes ?? 0n },
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    screenplayImportArtifact: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const store = {
    createUpload: options.uploadError
      ? vi.fn().mockRejectedValue(options.uploadError)
      : vi.fn().mockResolvedValue({ url: 'https://upload.test', expiresIn: 900 }),
  };
  const blobs = {
    capabilities: { directUpload: true },
    active: vi.fn(() => store),
  };
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new ScreenplayImportArtifactsService(
      prisma as never,
      permissions as never,
      blobs as never,
      db as never,
    ),
    prisma,
    permissions,
    store,
    blobs,
    db,
    tx,
    reserved,
  };
}

describe('ScreenplayImportArtifactsService reservation', () => {
  it('reserves screenplay-owned metadata and returns a capability-neutral upload target', async () => {
    const target = harness();

    await expect(
      target.service.reserve(
        '10000000-0000-4000-8000-000000000003',
        target.reserved.screenplayId,
        input,
      ),
    ).resolves.toMatchObject({
      id: target.reserved.id,
      sizeBytes: 42,
      uploadUrl: 'https://upload.test',
      expiresIn: 900,
      directUpload: true,
    });
    expect(target.permissions.assert).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000003',
      target.reserved.screenplayId,
      'edit_screenplay',
    );
    expect(target.db.acquireTransactionLock).toHaveBeenCalledWith(
      target.tx,
      'screenplay-import-artifact-reservations',
    );
    expect(target.tx.screenplayImportArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        screenplayId: target.reserved.screenplayId,
        createdByUserId: '10000000-0000-4000-8000-000000000003',
        originalFilename: 'pilot.docx',
        sourceFormat: 'docx',
      }) as unknown,
    });
    expect(target.store.createUpload).toHaveBeenCalledWith(
      expect.stringContaining('screenplay-imports/'),
      { contentType: 'application/docx', contentLength: 42 },
    );
  });

  it('never exposes objectKey or createdByUserId in the reservation response (issue #285)', async () => {
    const target = harness();

    const result = await target.service.reserve(
      '10000000-0000-4000-8000-000000000003',
      target.reserved.screenplayId,
      input,
    );

    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'screenplayId',
        'status',
        'originalFilename',
        'mimeType',
        'sizeBytes',
        'sourceFormat',
        'version',
        'createdAt',
        'completedAt',
        'failedAt',
        'uploadUrl',
        'expiresIn',
        'directUpload',
      ].sort(),
    );
    expect(result).not.toHaveProperty('objectKey');
    expect(result).not.toHaveProperty('createdByUserId');
  });

  it('rejects uploads beyond the configured asset ceiling before reserving', async () => {
    const target = harness();

    await expect(
      target.service.reserve('user', target.reserved.screenplayId, {
        ...input,
        sizeBytes: limits.ASSET_MAX_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(target.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('combines artifact and project-storage usage for the instance pending ceiling', async () => {
    const target = harness({
      instanceUsage: { count: limits.STORAGE_PENDING_INSTANCE_MAX_OBJECTS - 1, bytes: 0n },
      storageUsage: { count: 1, bytes: 0n },
    });

    await expect(
      target.service.reserve('user', target.reserved.screenplayId, input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(target.tx.screenplayImportArtifact.create).not.toHaveBeenCalled();
  });

  it('enforces per-screenplay incomplete byte capacity', async () => {
    const target = harness({
      screenplayUsage: {
        count: 1,
        bytes: BigInt(limits.STORAGE_PENDING_MAX_BYTES),
      },
    });

    await expect(
      target.service.reserve('user', target.reserved.screenplayId, input),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes the reservation when upload-target creation fails', async () => {
    const target = harness({ uploadError: new Error('signing failed') });

    await expect(
      target.service.reserve('user', target.reserved.screenplayId, input),
    ).rejects.toThrow('signing failed');
    expect(target.prisma.screenplayImportArtifact.deleteMany).toHaveBeenCalledWith({
      where: { id: target.reserved.id, status: 'PENDING' },
    });
  });
});
