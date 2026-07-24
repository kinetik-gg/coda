import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { evenlySpacedRanks } from '../common/rank';
import { PostgresDatabaseCapabilities } from '../database/postgres-database-capabilities';
import { BreakdownService } from './breakdown.service';

type RankForMove = (
  siblings: Array<{ id: string; position: string }>,
  beforeId: string | null | undefined,
  afterId: string | null | undefined,
  rebalance: (ranks: Array<{ id: string; position: string }>) => Promise<void>,
) => Promise<string>;

describe('BreakdownService ordering', () => {
  const service = new BreakdownService(
    {} as never,
    {} as never,
    new PostgresDatabaseCapabilities({} as never),
  );
  const rankForMove = (service as unknown as { rankForMove: RankForMove }).rankForMove.bind(
    service,
  );

  it('places a row immediately before a single boundary', async () => {
    const [first, second, third] = evenlySpacedRanks(3);
    const position = await rankForMove(
      [
        { id: 'first', position: first! },
        { id: 'second', position: second! },
        { id: 'third', position: third! },
      ],
      'second',
      undefined,
      () => Promise.resolve(),
    );
    expect(position > first! && position < second!).toBe(true);
  });

  it('rejects a boundary outside the target sibling group', async () => {
    await expect(
      rankForMove(
        [{ id: 'first', position: evenlySpacedRanks(1)[0]! }],
        'another-parent-row',
        undefined,
        () => Promise.resolve(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires paired boundaries to describe one adjacent gap', async () => {
    const [first, second, third] = evenlySpacedRanks(3);
    await expect(
      rankForMove(
        [
          { id: 'first', position: first! },
          { id: 'second', position: second! },
          { id: 'third', position: third! },
        ],
        'third',
        'first',
        () => Promise.resolve(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BreakdownService field definitions', () => {
  it('updates field metadata and reconciles options without deleting option records', async () => {
    const activeOption = { id: 'option-active' };
    const removedOption = { id: 'option-removed' };
    const updatedField = {
      id: 'field-id',
      projectId: 'project-id',
      entityTypeId: 'entity-type-id',
      name: 'Status',
      key: 'status',
      type: 'ENUM',
      version: 3,
      options: [activeOption, removedOption],
    };
    const tx = {
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue(updatedField),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...updatedField, version: 4 }),
      },
      fieldOption: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
      project: { update: vi.fn().mockResolvedValue({}) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new BreakdownService(
      prisma as never,
      permissions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await service.updateField('actor-id', 'project-id', 'field-id', {
      name: 'Production status',
      required: true,
      options: [
        { id: activeOption.id, label: 'In progress', color: '#ffaa00' },
        { label: 'Approved', color: '#33cc66' },
      ],
      version: 3,
    });

    const archived = tx.fieldOption.updateMany.mock.calls[0]![0] as unknown as {
      where: object;
      data: { archivedAt: Date };
    };
    expect(archived.where).toEqual({
      fieldId: 'field-id',
      id: { notIn: ['option-active'] },
      archivedAt: null,
    });
    expect(archived.data.archivedAt).toBeInstanceOf(Date);

    const optionUpdate = tx.fieldOption.update.mock.calls[0]![0] as unknown as {
      where: object;
      data: Record<string, unknown>;
    };
    expect(optionUpdate.where).toEqual({ id: 'option-active' });
    expect(optionUpdate.data).toMatchObject({ label: 'In progress', archivedAt: null });

    const optionCreate = tx.fieldOption.create.mock.calls[0]![0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(optionCreate.data).toMatchObject({ fieldId: 'field-id', label: 'Approved' });

    const fieldUpdate = tx.fieldDefinition.updateMany.mock.calls[0]![0] as unknown as {
      where: object;
      data: Record<string, unknown>;
    };
    expect(fieldUpdate.where).toEqual({
      id: 'field-id',
      projectId: 'project-id',
      version: 3,
      deletedAt: null,
    });
    expect(fieldUpdate.data).toMatchObject({
      name: 'Production status',
      required: true,
      version: { increment: 1 },
    });
  });

  it('rejects a stale field update before changing options', async () => {
    const tx = {
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field-id',
          projectId: 'project-id',
          type: 'ENUM',
          version: 7,
          options: [],
        }),
      },
      fieldOption: {
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new BreakdownService(
      prisma as never,
      permissions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(
      service.updateField('actor-id', 'project-id', 'field-id', {
        options: [{ label: 'New option' }],
        version: 6,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.fieldOption.updateMany).not.toHaveBeenCalled();
  });

  it('rejects options when updating a non-enum field', async () => {
    const tx = {
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field-id',
          projectId: 'project-id',
          type: 'TEXT',
          version: 2,
          options: [],
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const permissions = { assert: vi.fn().mockResolvedValue({}) };
    const service = new BreakdownService(
      prisma as never,
      permissions as never,
      new PostgresDatabaseCapabilities(prisma as never),
    );

    await expect(
      service.updateField('actor-id', 'project-id', 'field-id', {
        options: [{ label: 'Invalid' }],
        version: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
