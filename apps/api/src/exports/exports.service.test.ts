import { describe, expect, it, vi } from 'vitest';
import { csvCell, ExportsService } from './exports.service';

describe('ExportsService', () => {
  it.each([
    '=SUM(1,2)',
    '+cmd',
    '-1+2',
    '@SUM(1,2)',
    '  =HYPERLINK("x")',
    '\t@formula',
    '\ufeff=formula',
    '\u200b+formula',
  ])('neutralizes spreadsheet formulas in CSV text: %s', (value) => {
    expect(csvCell(value)).toContain("'");
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
  });

  it('preserves numeric values as numbers in CSV output', () => {
    expect(csvCell(-12)).toBe('-12');
  });

  it('omits account PII and object-store internals from a project export', async () => {
    const permissions = { assert: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'project-id',
          ownerUserId: 'private-owner-id',
          name: 'Example project',
          description: null,
          version: 1,
          revision: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          deletedAt: null,
          deletedById: null,
          deletionBatchId: null,
          memberships: [{ user: { email: 'private@example.com', displayName: 'Private Name' } }],
          roles: [],
          entityTypes: [],
          fields: [],
          items: [],
          sourceDocuments: [],
          storageObjects: [
            {
              id: 'storage-id',
              projectId: 'project-id',
              kind: 'file',
              status: 'READY',
              objectKey: 'private/internal/object-key',
              originalFilename: 'reference.dat',
              mimeType: 'application/octet-stream',
              sizeBytes: 123n,
              width: null,
              height: null,
              durationMs: null,
              version: 1,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              deletedAt: null,
              deletedById: null,
              deletionBatchId: null,
            },
          ],
        }),
      },
    };

    const service = new ExportsService(prisma as never, permissions as never);
    const output = await service.projectJson('user-id', 'project-id');

    expect(output).not.toContain('private@example.com');
    expect(output).not.toContain('Private Name');
    expect(output).not.toContain('private-owner-id');
    expect(output).not.toContain('private/internal/object-key');
    expect(output).not.toContain('deletionBatchId');
    expect(output).toContain('reference.dat');
  });
});
