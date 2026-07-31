import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION } from '@coda/contracts';
import { ScreenplayImportArtifactsService } from './screenplay-import-artifacts.service';

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
    sourceFormat: 'docx',
    adapter: { id: 'test-docx', version: '1.0.0' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    summary: { total: 1, preserved: 1, converted: 0, uncertain: 0, unsupported: 0 },
    warnings: [],
    elements: [
      {
        id: 'paragraph-1',
        status: 'preserved',
        source: {
          kind: 'paragraph',
          location: { unit: 'paragraph', start: 0, end: 1 },
        },
        target: { kind: 'action', location: { unit: 'line', start: 0, end: 1 } },
        summary: 'Paragraph preserved.',
        warnings: [],
      },
    ],
    ...overrides,
  };
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    screenplayId: '10000000-0000-4000-8000-000000000002',
    createdByUserId: '10000000-0000-4000-8000-000000000003',
    status: 'PENDING',
    objectKey: 'screenplay-imports/screenplay/artifact/original',
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

function harness(
  options: {
    pending?: ReturnType<typeof artifact> | null;
    ready?: ReturnType<typeof artifact> | null;
    stat?: { size?: number; contentType?: string };
    statError?: Error;
    updateCount?: number;
  } = {},
) {
  const pending = options.pending === undefined ? artifact() : options.pending;
  const ready =
    options.ready === undefined
      ? artifact({
          status: 'READY',
          convertedFountain: 'INT. ROOM - DAY\n',
          reportSchemaVersion: 1,
          conversionReport: report(),
          version: 2,
          completedAt: new Date('2026-07-30T00:01:00.000Z'),
        })
      : options.ready;
  const findFirst =
    pending === null
      ? vi.fn().mockResolvedValue(ready)
      : vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(ready);
  const prisma = {
    screenplay: { findFirst: vi.fn().mockResolvedValue({ id: artifact().screenplayId }) },
    screenplayImportArtifact: {
      findFirst,
      updateMany: vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 }),
    },
  };
  const permissions = { assert: vi.fn().mockResolvedValue({}) };
  const store = {
    stat: options.statError
      ? vi.fn().mockRejectedValue(options.statError)
      : vi.fn().mockResolvedValue(options.stat ?? { size: 42, contentType: 'application/docx' }),
    createReadUrl: vi.fn().mockResolvedValue({ url: 'https://read.test', expiresIn: 900 }),
  };
  const blobs = { capabilities: { directUpload: true }, active: vi.fn(() => store) };
  const service = new ScreenplayImportArtifactsService(
    prisma as never,
    permissions as never,
    blobs as never,
    { acquireTransactionLock: vi.fn() } as never,
  );
  return { service, prisma, permissions, store, pending, ready };
}

const completion = {
  version: 1,
  convertedFountain: 'INT. ROOM - DAY\n',
  report: report(),
};

describe('ScreenplayImportArtifactsService completion', () => {
  it('atomically completes immutable Fountain and report evidence after blob verification', async () => {
    const target = harness();

    await expect(
      target.service.complete('user', artifact().screenplayId, artifact().id, completion as never),
    ).resolves.toMatchObject({
      status: 'READY',
      sizeBytes: 42,
      convertedFountain: 'INT. ROOM - DAY\n',
      conversionReport: expect.objectContaining({ schemaVersion: 1 }) as unknown,
    });
    expect(target.store.stat).toHaveBeenCalledWith(artifact().objectKey);
    expect(target.prisma.screenplayImportArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: artifact().id,
        screenplayId: artifact().screenplayId,
        status: 'PENDING',
        version: 1,
      },
      data: expect.objectContaining({
        status: 'READY',
        convertedFountain: completion.convertedFountain,
        reportSchemaVersion: 1,
        version: { increment: 1 },
      }) as unknown,
    });
  });

  it('rejects reports for a different source format without consuming the reservation', async () => {
    const target = harness();

    await expect(
      target.service.complete('user', artifact().screenplayId, artifact().id, {
        ...completion,
        report: report({ sourceFormat: 'rtf' }),
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(target.store.stat).not.toHaveBeenCalled();
    expect(target.prisma.screenplayImportArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('marks a missing original blob failed for cleanup', async () => {
    const target = harness({ statError: new Error('missing') });

    await expect(
      target.service.complete('user', artifact().screenplayId, artifact().id, completion as never),
    ).rejects.toThrow('Reserved original upload is missing');
    expect(target.prisma.screenplayImportArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifact().id, status: 'PENDING', version: 1 },
      data: {
        status: 'FAILED',
        failedAt: expect.any(Date) as Date,
        version: { increment: 1 },
      },
    });
  });

  it('marks mismatched blob metadata failed', async () => {
    const target = harness({ stat: { size: 41, contentType: 'application/docx' } });

    await expect(
      target.service.complete('user', artifact().screenplayId, artifact().id, completion as never),
    ).rejects.toThrow('Uploaded object metadata does not match');
    expect(target.prisma.screenplayImportArtifact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }) as unknown,
      }),
    );
  });

  it('reports an optimistic conflict without overwriting completed evidence', async () => {
    const target = harness({ updateCount: 0 });

    await expect(
      target.service.complete('user', artifact().screenplayId, artifact().id, completion as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ScreenplayImportArtifactsService reads', () => {
  it('schema-validates a persisted report on every artifact read', async () => {
    const target = harness({ pending: null });

    await expect(
      target.service.get('user', artifact().screenplayId, artifact().id),
    ).resolves.toMatchObject({
      id: artifact().id,
      conversionReport: expect.objectContaining({ schemaVersion: 1 }) as unknown,
    });
    expect(target.permissions.assert).toHaveBeenCalledWith(
      'user',
      artifact().screenplayId,
      'read_screenplay',
    );
  });

  it('refuses persisted reports whose summary no longer validates', async () => {
    const invalid = artifact({
      status: 'READY',
      convertedFountain: 'INT. ROOM - DAY\n',
      reportSchemaVersion: 1,
      conversionReport: report({
        summary: { total: 1, preserved: 0, converted: 0, uncertain: 0, unsupported: 1 },
      }),
      version: 2,
    });
    const target = harness({ pending: null, ready: invalid });

    await expect(
      target.service.get('user', artifact().screenplayId, artifact().id),
    ).rejects.toThrow('Summary preserved does not match conversion elements');
  });

  it('never exposes objectKey or createdByUserId, and returns exactly the documented field set (issue #285)', async () => {
    const target = harness({ pending: null });

    const result = await target.service.get('user', artifact().screenplayId, artifact().id);

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
        'convertedFountain',
        'conversionReport',
      ].sort(),
    );
    expect(result).not.toHaveProperty('objectKey');
    expect(result).not.toHaveProperty('createdByUserId');
    expect(result).not.toHaveProperty('reportSchemaVersion');
  });

  it('returns an attachment read URL for the byte-identical original', async () => {
    const target = harness({ pending: null });

    await expect(
      target.service.originalReadUrl('user', artifact().screenplayId, artifact().id),
    ).resolves.toEqual({ url: 'https://read.test', expiresIn: 900 });
    expect(target.store.createReadUrl).toHaveBeenCalledWith(artifact().objectKey, {
      disposition: "attachment; filename*=UTF-8''pilot.docx",
      contentType: 'application/docx',
    });
  });
});
