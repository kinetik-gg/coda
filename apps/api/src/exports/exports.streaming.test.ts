import { describe, expect, it, vi } from 'vitest';
import { ExportsService } from './exports.service';
import { EXPORT_BATCH_SIZE } from './project-json.stream';

function transactional<T extends object>(client: T) {
  return {
    ...client,
    $transaction: vi.fn((operation: (transaction: T) => Promise<void>) => operation(client)),
  };
}

function csvItem(index: number) {
  return {
    id: `item-${index}`,
    parentId: null,
    parent: null,
    displayCode: null,
    title: `Item ${index}`,
    description: null,
    values: [],
  };
}

function projectItem(index: number) {
  return {
    id: `item-${index}`,
    entityTypeId: 'type',
    parentId: null,
    title: `Item ${index}`,
    displayCode: null,
    description: null,
    position: String(index).padStart(4, '0'),
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    values: [],
    sourceReferences: [],
  };
}

async function consumeRemaining(iterator: AsyncIterator<string>): Promise<string> {
  let output = '';
  for (;;) {
    const next = await iterator.next();
    if (next.done) return output;
    output += next.value;
  }
}

describe('ExportsService demand-driven streaming', () => {
  it('fetches CSV rows in cursor pages only as the consumer requests chunks', async () => {
    const firstPage = Array.from({ length: EXPORT_BATCH_SIZE }, (_, index) => csvItem(index));
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([csvItem(EXPORT_BATCH_SIZE)]);
    const service = new ExportsService(
      {
        entityType: { findFirstOrThrow: vi.fn().mockResolvedValue({ pluralName: 'Items' }) },
        fieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
        breakdownItem: { findMany },
      } as never,
      { assert: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const exportResult = await service.levelCsv('user', 'project', 'type');
    const iterator = exportResult.content[Symbol.asyncIterator]();
    expect(findMany).not.toHaveBeenCalled();

    const header = await iterator.next();
    expect(header.value).toContain('display_code');
    expect(findMany).not.toHaveBeenCalled();

    let rowCount = 0;
    for (let index = 0; index < EXPORT_BATCH_SIZE; index += 1) {
      const row = await iterator.next();
      expect(row.done).toBe(false);
      rowCount += 1;
    }
    expect(findMany).toHaveBeenCalledTimes(1);

    const nextPageRow = await iterator.next();
    expect(nextPageRow.value).toContain(`item-${EXPORT_BATCH_SIZE}`);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: `item-${EXPORT_BATCH_SIZE - 1}` }, skip: 1 }),
    );
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(rowCount + 1).toBe(EXPORT_BATCH_SIZE + 1);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('does not fetch a later JSON item page until the prior page is consumed', async () => {
    const items = Array.from({ length: EXPORT_BATCH_SIZE }, (_, index) => projectItem(index));
    const findItems = vi
      .fn()
      .mockResolvedValueOnce(items)
      .mockResolvedValueOnce([projectItem(EXPORT_BATCH_SIZE)]);
    const emptyPage = vi.fn().mockResolvedValue([]);
    const prisma = transactional({
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'project',
          name: 'Project',
          description: null,
          version: 1,
          revision: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
      projectRole: { findMany: emptyPage },
      entityType: { findMany: emptyPage },
      fieldDefinition: { findMany: emptyPage },
      breakdownItem: { findMany: findItems },
      sourceDocument: { findMany: emptyPage },
      storageObject: { findMany: emptyPage },
    });
    const service = new ExportsService(
      prisma as never,
      { assert: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const exportResult = await service.projectJson('user', 'project');
    const iterator = exportResult.content[Symbol.asyncIterator]();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const chunks: string[] = [];
    for (;;) {
      const chunk = String((await iterator.next()).value ?? '');
      chunks.push(chunk);
      if (chunk === ',"items":') break;
    }
    chunks.push(String((await iterator.next()).value ?? ''));
    expect(findItems).not.toHaveBeenCalled();

    for (let index = 0; index < EXPORT_BATCH_SIZE; index += 1) {
      chunks.push(String((await iterator.next()).value ?? ''));
    }
    expect(findItems).toHaveBeenCalledTimes(1);

    chunks.push(String((await iterator.next()).value ?? ''));
    expect(findItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: `item-${EXPORT_BATCH_SIZE - 1}` }, skip: 1 }),
    );
    expect(findItems).toHaveBeenCalledTimes(2);
    const output = chunks.join('') + (await consumeRemaining(iterator));
    const parsed = JSON.parse(output) as { project: { items: unknown[] } };
    expect(parsed.project.items).toHaveLength(EXPORT_BATCH_SIZE + 1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
    exportResult.release();
  });

  it('cancels the snapshot transaction when the consumer abandons the stream', async () => {
    const transaction = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'project',
          name: 'Project',
          description: null,
          version: 1,
          revision: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
    };
    let rolledBack = false;
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<void>) => {
        try {
          await operation(transaction);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      }),
    };
    const service = new ExportsService(
      prisma as never,
      { assert: vi.fn().mockResolvedValue(undefined) } as never,
    );
    const exportResult = await service.projectJson('user', 'project');
    const iterator = exportResult.content[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await iterator.return?.(undefined);

    expect(rolledBack).toBe(true);
    exportResult.release();
  });
});
