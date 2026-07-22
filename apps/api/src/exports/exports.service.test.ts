import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { csvCell, ExportsService } from './exports.service';

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let output = '';
  for await (const chunk of chunks) output += chunk;
  return output;
}

describe('ExportsService', () => {
  it('admits only one snapshot export per user until the caller releases it', async () => {
    const service = new ExportsService(
      {} as never,
      { assert: vi.fn().mockResolvedValue(undefined) } as never,
    );
    const first = await service.projectJson('user', 'project');

    try {
      await service.projectJson('user', 'project');
      throw new Error('Expected the second snapshot export to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    first.release();
    const next = await service.projectJson('user', 'project');
    next.release();
  });

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
    const storage = {
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
    };
    const transaction = {
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
        }),
      },
      projectRole: { findMany: vi.fn().mockResolvedValue([]) },
      entityType: { findMany: vi.fn().mockResolvedValue([]) },
      fieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      breakdownItem: { findMany: vi.fn().mockResolvedValue([]) },
      sourceDocument: { findMany: vi.fn().mockResolvedValue([]) },
      storageObject: { findMany: vi.fn().mockResolvedValue([storage]) },
    };
    const prisma = {
      ...transaction,
      $transaction: vi.fn((operation: (client: typeof transaction) => Promise<void>) =>
        operation(transaction),
      ),
    };

    const service = new ExportsService(prisma as never, permissions as never);
    const result = await service.projectJson('user-id', 'project-id');
    const output = await collect(result.content);
    result.release();

    expect(output).not.toContain('private@example.com');
    expect(output).not.toContain('Private Name');
    expect(output).not.toContain('private-owner-id');
    expect(output).not.toContain('private/internal/object-key');
    expect(output).not.toContain('deletionBatchId');
    expect(output).toContain('reference.dat');
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
});
