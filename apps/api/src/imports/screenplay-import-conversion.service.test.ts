import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ScreenplayAdapterFailureReason } from '@coda/contracts';
import { ScreenplayImportConversionService } from './screenplay-import-conversion.service';

const artifactId = '10000000-0000-4000-8000-000000000002';
const screenplayId = '10000000-0000-4000-8000-000000000001';

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    screenplayId,
    createdByUserId: '10000000-0000-4000-8000-000000000003',
    status: 'PENDING',
    objectKey: `screenplay-imports/${screenplayId}/${artifactId}/original`,
    originalFilename: 'pilot.demo',
    mimeType: 'application/octet-stream',
    sizeBytes: 4n,
    sourceFormat: 'coda-runtime-test',
    version: 1,
    ...overrides,
  };
}

function report() {
  return {
    schemaVersion: 1,
    sourceFormat: 'coda-runtime-test',
    adapter: { id: 'coda.runtime-test', version: '1' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    summary: { total: 0, preserved: 0, converted: 0, uncertain: 0, unsupported: 0 },
    warnings: [],
    elements: [],
  };
}

function harness(options: {
  outcome?: { ok: boolean; reason?: ScreenplayAdapterFailureReason; message?: string };
  artifact?: Record<string, unknown>;
  bytes?: Uint8Array;
  getRejects?: boolean;
  admissible?: boolean;
}) {
  const permissions = { assert: vi.fn().mockResolvedValue(undefined) };
  const artifacts = {
    pendingForConversion: vi.fn().mockResolvedValue(options.artifact ?? artifact()),
    failConversion: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue({ id: artifactId, status: 'READY' }),
  };
  const store = {
    get: options.getRejects
      ? vi.fn().mockRejectedValue(new Error('missing'))
      : vi.fn().mockResolvedValue({
          stream: Readable.from([options.bytes ?? new Uint8Array([1, 2, 3, 4])]),
        }),
  };
  const blobs = { active: () => store };
  const runtime = {
    isAdmissible: vi.fn().mockReturnValue(options.admissible ?? true),
    maxInputBytes: vi.fn().mockReturnValue(1_048_576),
    convert: vi
      .fn()
      .mockResolvedValue(
        options.outcome ?? { ok: true, convertedFountain: '!Line', report: report() },
      ),
  };
  return {
    service: new ScreenplayImportConversionService(
      permissions as never,
      blobs as never,
      artifacts as never,
      runtime as never,
    ),
    permissions,
    artifacts,
    runtime,
    store,
  };
}

describe('ScreenplayImportConversionService', () => {
  it('completes the artifact with the server-assembled report', async () => {
    const target = harness({});
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).resolves.toEqual({ id: artifactId, status: 'READY' });
    expect(target.permissions.assert).toHaveBeenCalledWith(
      'user-id',
      screenplayId,
      'edit_screenplay',
    );
    expect(target.artifacts.complete).toHaveBeenCalledWith('user-id', screenplayId, artifactId, {
      version: 1,
      convertedFountain: '!Line',
      report: report(),
    });
    expect(target.artifacts.failConversion).not.toHaveBeenCalled();
  });

  it('hands the runtime the exact uploaded bytes and the declared filename', async () => {
    const target = harness({ bytes: new Uint8Array([9, 8, 7, 6]) });
    await target.service.convert('user-id', screenplayId, artifactId, { version: 1 });
    expect(target.runtime.convert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFormat: 'coda-runtime-test',
        originalFilename: 'pilot.demo',
      }),
    );
    const [{ bytes }] = target.runtime.convert.mock.calls[0] as [{ bytes: Uint8Array }];
    expect([...bytes]).toEqual([9, 8, 7, 6]);
  });

  it.each([
    ['timeout', 504],
    ['memory', 422],
    ['output-too-large', 422],
    ['element-limit', 422],
    ['invalid-source', 400],
    ['capacity', 503],
    ['input-too-large', 413],
    ['cancelled', 408],
    ['protocol-error', 500],
    ['internal', 500],
  ] as const)(
    'marks the artifact FAILED and answers %s with %i, creating no screenplay',
    async (reason, status) => {
      const target = harness({ outcome: { ok: false, reason, message: 'conversion failed' } });
      await expect(
        target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
      ).rejects.toMatchObject({ status });
      expect(target.artifacts.failConversion).toHaveBeenCalledWith(artifact());
      expect(target.artifacts.complete).not.toHaveBeenCalled();
    },
  );

  it('never leaks a runtime defect to the client', async () => {
    const target = harness({
      outcome: { ok: false, reason: 'internal', message: 'C:\\secret\\path exploded' },
    });
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).rejects.toThrow('Screenplay conversion failed');
  });

  it('fails the artifact when no adapter serves its format, without reading the original', async () => {
    const target = harness({ admissible: false });
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.store.get).not.toHaveBeenCalled();
    expect(target.artifacts.failConversion).toHaveBeenCalled();
  });

  it('fails the artifact when the reservation exceeds the input ceiling, without reading it', async () => {
    const target = harness({ artifact: artifact({ sizeBytes: 2_000_000n }) });
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).rejects.toMatchObject({ status: 413 });
    expect(target.store.get).not.toHaveBeenCalled();
    expect(target.runtime.convert).not.toHaveBeenCalled();
    expect(target.artifacts.failConversion).toHaveBeenCalled();
  });

  it('fails the artifact when the original cannot be read', async () => {
    const target = harness({ getRejects: true });
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.artifacts.failConversion).toHaveBeenCalled();
    expect(target.runtime.convert).not.toHaveBeenCalled();
  });

  it('fails the artifact when the stored original no longer matches the reservation', async () => {
    const target = harness({ bytes: new Uint8Array([1, 2]) });
    await expect(
      target.service.convert('user-id', screenplayId, artifactId, { version: 1 }),
    ).rejects.toThrow('Reserved original upload could not be read');
    expect(target.artifacts.failConversion).toHaveBeenCalled();
    expect(target.runtime.convert).not.toHaveBeenCalled();
  });
});
