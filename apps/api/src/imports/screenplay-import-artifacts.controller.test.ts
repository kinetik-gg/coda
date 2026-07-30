import { describe, expect, it, vi } from 'vitest';
import { ScreenplayImportArtifactsController } from './screenplay-import-artifacts.controller';

const request = { user: { id: 'user-id' } };
const screenplayId = '10000000-0000-4000-8000-000000000001';
const artifactId = '10000000-0000-4000-8000-000000000002';

function report() {
  return {
    schemaVersion: 1,
    sourceFormat: 'docx',
    adapter: { id: 'test-docx', version: '1.0.0' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    summary: { total: 0, preserved: 0, converted: 0, uncertain: 0, unsupported: 0 },
    warnings: [],
    elements: [],
  };
}

function harness() {
  const artifacts = {
    reserve: vi.fn().mockResolvedValue({ id: artifactId }),
    complete: vi.fn().mockResolvedValue({ id: artifactId, status: 'READY' }),
    get: vi.fn().mockResolvedValue({ id: artifactId, status: 'READY' }),
    originalReadUrl: vi.fn().mockResolvedValue({ url: 'https://read.test' }),
  };
  return {
    controller: new ScreenplayImportArtifactsController(artifacts as never),
    artifacts,
  };
}

describe('ScreenplayImportArtifactsController', () => {
  it('validates and forwards upload reservations', async () => {
    const target = harness();
    await expect(
      target.controller.reserve(request as never, screenplayId, {
        originalFilename: ' Pilot.DOCX ',
        mimeType: 'application/docx',
        sizeBytes: 42,
        sourceFormat: ' DOCX ',
      }),
    ).resolves.toEqual({ data: { id: artifactId } });
    expect(target.artifacts.reserve).toHaveBeenCalledWith('user-id', screenplayId, {
      originalFilename: 'Pilot.DOCX',
      mimeType: 'application/docx',
      sizeBytes: 42,
      sourceFormat: 'docx',
    });
  });

  it('validates and forwards immutable completion evidence', async () => {
    const target = harness();
    await target.controller.complete(request as never, screenplayId, artifactId, {
      version: 1,
      convertedFountain: 'INT. ROOM - DAY\n',
      report: report(),
    });
    expect(target.artifacts.complete).toHaveBeenCalledWith(
      'user-id',
      screenplayId,
      artifactId,
      expect.objectContaining({
        version: 1,
        report: expect.objectContaining({ schemaVersion: 1 }) as unknown,
      }),
    );
  });

  it('forwards artifact reads', async () => {
    const target = harness();
    await expect(
      target.controller.get(request as never, screenplayId, artifactId),
    ).resolves.toEqual({ data: { id: artifactId, status: 'READY' } });
    expect(target.artifacts.get).toHaveBeenCalledWith('user-id', screenplayId, artifactId);
  });

  it('forwards original-blob reads', async () => {
    const target = harness();
    await expect(
      target.controller.original(request as never, screenplayId, artifactId),
    ).resolves.toEqual({ data: { url: 'https://read.test' } });
    expect(target.artifacts.originalReadUrl).toHaveBeenCalledWith(
      'user-id',
      screenplayId,
      artifactId,
    );
  });
});
