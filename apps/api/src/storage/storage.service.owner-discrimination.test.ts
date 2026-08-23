import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
  env: () => ({
    PDF_MAX_BYTES: 100,
    ASSET_MAX_BYTES: 200,
    STORAGE_PENDING_MAX_OBJECTS: 20,
    STORAGE_PENDING_MAX_BYTES: 1_000,
    STORAGE_PENDING_INSTANCE_MAX_OBJECTS: 100,
    STORAGE_PENDING_INSTANCE_MAX_BYTES: 10_000,
    SIGNED_UPLOAD_TTL_SECONDS: 900,
    SIGNED_READ_TTL_SECONDS: 300,
  }),
}));

import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { StorageService } from './storage.service';

const trackerObject = {
  id: 'storage-tracker-1',
  trackerId: 'tracker-1',
  projectId: null,
  kind: 'IMAGE',
  objectKey: 'tracker-1/object',
  originalFilename: 'photo.png',
  mimeType: 'image/png',
  sizeBytes: 10n,
  status: 'PENDING',
  version: 1,
  deletedAt: null,
};

function fakeStore(directUpload = true) {
  return {
    capabilities: { directUpload, presignedRead: directUpload },
    init: vi.fn().mockResolvedValue(undefined),
    healthcheck: vi.fn().mockResolvedValue(undefined),
    createUpload: vi.fn().mockResolvedValue({ url: 'https://objects.test/upload', expiresIn: 900 }),
    createReadUrl: vi
      .fn()
      .mockResolvedValue({ url: 'https://objects.test/signed', expiresIn: 300 }),
    stat: vi.fn().mockResolvedValue({ size: 10, contentType: 'image/png' }),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function serviceWith(storeOverrides: Record<string, unknown> = {}) {
  const store = Object.assign(fakeStore(), storeOverrides);
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const trackerPermissions = { assert: vi.fn().mockResolvedValue({}) };
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: 'project-1' }) },
    tracker: { findFirst: vi.fn().mockResolvedValue({ id: 'tracker-1' }) },
    storageObject: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _count: { id: 0 }, _sum: { sizeBytes: null } }),
      create: vi.fn().mockResolvedValue(trackerObject),
      findFirst: vi.fn().mockResolvedValue(trackerObject),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...trackerObject, ...data, version: 2 }),
        ),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  Reflect.set(
    prisma,
    '$transaction',
    vi.fn((callback: (tx: typeof prisma) => unknown) => callback(prisma)),
  );
  return {
    prisma,
    permissions,
    trackerPermissions,
    store,
    service: new StorageService(
      prisma as never,
      permissions as never,
      trackerPermissions as never,
      { capabilities: store.capabilities, active: () => store } as never,
      new PostgresDatabaseCapabilities(prisma as never),
    ),
  };
}

const trackerOwner = { kind: 'tracker', id: 'tracker-1' } as const;
const imageUpload = {
  kind: 'image',
  filename: 'photo.png',
  mimeType: 'image/png',
  sizeBytes: 10,
} as const;

describe('StorageService ownership discrimination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps exactly the tracker side of the discriminator on reservation', async () => {
    const { service, prisma, trackerPermissions, permissions } = serviceWith();

    await service.createUpload('user-1', imageUpload, trackerOwner);

    expect(trackerPermissions.assert).toHaveBeenCalledWith(
      'user-1',
      'tracker-1',
      'edit_tracker_records',
    );
    expect(permissions.assert).not.toHaveBeenCalled();
    const data = (
      prisma.storageObject.create.mock.calls[0]?.[0] as unknown as {
        data: { projectId: string | null; trackerId: string | null; objectKey: string };
      }
    ).data;
    expect(data.projectId).toBeNull();
    expect(data.trackerId).toBe('tracker-1');
    expect(data.objectKey).toMatch(/^tracker-1\//u);
  });

  it('stamps exactly the project side for a project upload (never both)', async () => {
    const { service, prisma } = serviceWith();
    prisma.storageObject.create.mockResolvedValueOnce({
      ...trackerObject,
      projectId: 'project-1',
      trackerId: null,
    });

    await service.createUpload(
      'user-1',
      { kind: 'file', filename: 'a.bin', mimeType: 'application/octet-stream', sizeBytes: 5 },
      { kind: 'project', id: 'project-1' },
    );

    const data = (
      prisma.storageObject.create.mock.calls[0]?.[0] as unknown as {
        data: { projectId: string | null; trackerId: string | null };
      }
    ).data;
    expect(data.projectId).toBe('project-1');
    expect(data.trackerId).toBeNull();
  });

  it('rejects source-document kinds for trackers before any permission or row write', async () => {
    const { service, prisma, trackerPermissions, store } = serviceWith();
    trackerPermissions.assert.mockRejectedValue(new Error('permission must not run'));

    await expect(
      service.createUpload(
        'user-1',
        {
          kind: 'source_document',
          filename: 'script.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        },
        trackerOwner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
    expect(store.createUpload).not.toHaveBeenCalled();
  });

  it('rechecks the owning tracker under the lifecycle lock and rejects a trashed one', async () => {
    const { service, prisma, store } = serviceWith();
    prisma.tracker.findFirst.mockResolvedValueOnce(null);

    await expect(service.createUpload('user-1', imageUpload, trackerOwner)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // One advisory statement: the tracker-lifecycle lock; the reservation lock never runs.
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
    expect(store.createUpload).not.toHaveBeenCalled();
  });

  it('applies the pending-capacity contract to tracker-owned rows only', async () => {
    const { service, prisma } = serviceWith();
    prisma.storageObject.aggregate.mockImplementation((query: { where: Record<string, unknown> }) =>
      Promise.resolve(
        query.where.trackerId || query.where.projectId
          ? { _count: { id: 20 }, _sum: { sizeBytes: 100n } }
          : { _count: { id: 0 }, _sum: { sizeBytes: null } },
      ),
    );

    await expect(service.createUpload('user-1', imageUpload, trackerOwner)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const ownerAggregate = prisma.storageObject.aggregate.mock.calls[0]?.[0] as unknown as {
      where: { trackerId?: string; projectId?: string };
    };
    expect(ownerAggregate.where.trackerId).toBe('tracker-1');
    expect(ownerAggregate.where.projectId).toBeUndefined();
    expect(prisma.storageObject.create).not.toHaveBeenCalled();
  });

  it('completes and reads tracker-owned objects through the tracker permission path', async () => {
    const { service, prisma, trackerPermissions, permissions, store } = serviceWith();

    await service.completeUpload('user-1', 'storage-tracker-1', 1, trackerOwner);
    expect(prisma.storageObject.findFirst).toHaveBeenCalledWith({
      where: { id: 'storage-tracker-1', trackerId: 'tracker-1', deletedAt: null },
    });
    expect(trackerPermissions.assert).toHaveBeenCalledWith(
      'user-1',
      'tracker-1',
      'edit_tracker_records',
    );
    expect(permissions.assert).not.toHaveBeenCalled();

    await service.readUrl('user-1', 'storage-tracker-1', trackerOwner);
    expect(trackerPermissions.assert).toHaveBeenLastCalledWith(
      'user-1',
      'tracker-1',
      'read_tracker',
    );
    expect(prisma.storageObject.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'storage-tracker-1', trackerId: 'tracker-1', status: 'READY', deletedAt: null },
    });
    expect(store.createReadUrl).toHaveBeenCalledWith('tracker-1/object', {
      disposition: "attachment; filename*=UTF-8''photo.png",
      contentType: 'application/octet-stream',
    });
  });

  it('surfaces the driver capability so proxied drivers hand out their app URL instead', async () => {
    const proxiedUrl = 'http://app.test/api/v1/blob/upload/token';
    const { service, store } = serviceWith({
      capabilities: { directUpload: false, presignedRead: false },
      createUpload: vi.fn().mockResolvedValue({ url: proxiedUrl, expiresIn: 900 }),
    });

    const result = await service.createUpload('user-1', imageUpload, trackerOwner);

    expect(result.uploadUrl).toBe(proxiedUrl);
    expect(result.directUpload).toBe(false);
    expect(store.capabilities.directUpload).toBe(false);
  });
});
