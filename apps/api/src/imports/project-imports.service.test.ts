import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { parseProjectImport, type ProjectImportDocument } from './project-import.schema';
import { ProjectImportsService } from './project-imports.service';

const projectId = '00000000-0000-4000-8000-000000000001';
const typeId = '00000000-0000-4000-8000-000000000002';
const itemId = '00000000-0000-4000-8000-000000000003';

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

function importDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    exportedAt: '2026-07-22T00:00:00.000Z',
    project: {
      id: projectId,
      name: 'Imported project',
      description: null,
      version: 1,
      revision: 1,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      roles: [],
      entityTypes: [
        {
          id: typeId,
          parentTypeId: null,
          singularName: 'Item',
          pluralName: 'Items',
          displayPrefix: null,
          level: 1,
          position: 'rank',
          enabled: true,
          version: 1,
        },
      ],
      fields: [],
      items: [
        {
          id: itemId,
          entityTypeId: typeId,
          parentId: null,
          title: 'Imported item',
          displayCode: null,
          description: null,
          position: 'rank',
          version: 1,
          createdAt: '2026-07-22T00:00:00.000Z',
          updatedAt: '2026-07-22T00:00:00.000Z',
          values: [],
          sourceReferences: [],
        },
      ],
      sourceDocuments: [],
      storageObjects: [],
      ...overrides,
    },
  };
}

function richImportDocument(): ProjectImportDocument {
  const secondTypeId = uuid(20);
  const secondItemId = uuid(21);
  const types = [
    ...importDocument().project.entityTypes,
    {
      id: secondTypeId,
      parentTypeId: typeId,
      singularName: 'Child',
      pluralName: 'Children',
      displayPrefix: 'CH',
      level: 2,
      position: 'rank-2',
      enabled: true,
      version: 1,
    },
  ];
  const fieldTypes = [
    'TEXT',
    'LONG_TEXT',
    'INTEGER',
    'FLOAT',
    'BOOLEAN',
    'DATE',
    'ENUM',
    'MULTI_ENUM',
    'FILE',
    'IMAGE',
    'VIDEO',
  ] as const;
  const fields = fieldTypes.map((type, index) => ({
    id: uuid(100 + index),
    entityTypeId: typeId,
    name: `${type} field`,
    key: `field_${index}`,
    type,
    required: false,
    position: `field-${index}`,
    configuration: {},
    version: 1,
    options:
      type === 'ENUM' || type === 'MULTI_ENUM'
        ? [
            {
              id: uuid(300 + index),
              label: `${type} option`,
              color: null,
              position: 'option-1',
            },
          ]
        : [],
  }));
  const values = fields.map((field, index) => ({
    id: uuid(200 + index),
    fieldId: field.id,
    textValue: field.type === 'TEXT' || field.type === 'LONG_TEXT' ? 'Text' : null,
    integerValue: field.type === 'INTEGER' ? 2 : null,
    floatValue: field.type === 'FLOAT' ? 2.5 : null,
    booleanValue: field.type === 'BOOLEAN' ? true : null,
    dateValue: field.type === 'DATE' ? '2026-07-22T00:00:00.000Z' : null,
    optionId: field.type === 'ENUM' ? field.options[0]!.id : null,
    optionIds: field.type === 'MULTI_ENUM' ? [field.options[0]!.id] : [],
    storageObjectId: ['FILE', 'IMAGE', 'VIDEO'].includes(field.type) ? uuid(400 + index) : null,
  }));
  return importDocument({
    entityTypes: types,
    fields,
    items: [
      {
        ...importDocument().project.items[0],
        values,
        sourceReferences: [
          {
            id: uuid(500),
            sourceDocumentId: uuid(501),
            startPage: 1,
            endPage: 2,
            position: 'source-1',
          },
        ],
      },
      {
        ...importDocument().project.items[0],
        id: secondItemId,
        entityTypeId: secondTypeId,
        parentId: itemId,
        title: 'Child item',
        values: [],
      },
    ],
    sourceDocuments: [{ id: uuid(501) }],
    storageObjects: [{ id: uuid(502) }],
  }) as unknown as ProjectImportDocument;
}

describe('project import validation', () => {
  it('accepts the current portable project schema', () => {
    const parsed = parseProjectImport(JSON.stringify(importDocument()));
    expect(parsed.project.name).toBe('Imported project');
    expect(parsed.project.items).toHaveLength(1);
  });

  it('rejects an item whose entity type is absent', () => {
    const invalid = importDocument({
      items: [
        {
          ...importDocument().project.items[0],
          entityTypeId: '00000000-0000-4000-8000-000000000099',
        },
      ],
    });
    expect(() => parseProjectImport(JSON.stringify(invalid))).toThrow(BadRequestException);
  });

  it('accepts every supported typed value and a valid parent chain', () => {
    const parsed = parseProjectImport(JSON.stringify(richImportDocument()));
    expect(parsed.project.fields).toHaveLength(11);
    expect(parsed.project.items).toHaveLength(2);
  });

  it('enforces the payload size before attempting JSON parsing', () => {
    expect(() => parseProjectImport('x'.repeat(25 * 1024 * 1024 + 1))).toThrow('25 MB limit');
  });

  it.each([
    [
      'duplicate object identifiers',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.items.push({ ...document.project.items[0]! });
      },
    ],
    [
      'continuous',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.entityTypes[1]!.level = 3;
      },
    ],
    [
      'parents',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.entityTypes[1]!.parentTypeId = null;
      },
    ],
    [
      'unknown entity type',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.fields[0]!.entityTypeId = uuid(999);
      },
    ],
    [
      'duplicate option identifiers',
      (document: ReturnType<typeof richImportDocument>) => {
        const field = document.project.fields.find((entry) => entry.type === 'ENUM')!;
        field.options.push({ ...field.options[0]! });
      },
    ],
    [
      'duplicate option identifiers',
      (document: ReturnType<typeof richImportDocument>) => {
        const fields = document.project.fields.filter((entry) => entry.options.length);
        fields[1]!.options[0]!.id = fields[0]!.options[0]!.id;
      },
    ],
    [
      'Level-one items',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.items[0]!.parentId = uuid(21);
      },
    ],
    [
      'valid parent item',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.items[1]!.parentId = null;
      },
    ],
    [
      'duplicate field values',
      (document: ReturnType<typeof richImportDocument>) => {
        document.project.items[0]!.values.push({
          ...document.project.items[0]!.values[0]!,
          id: uuid(999),
        });
      },
    ],
    [
      'invalid enum option',
      (document: ReturnType<typeof richImportDocument>) => {
        const value = document.project.items[0]!.values.find((entry) => entry.optionId)!;
        value.optionId = uuid(999);
      },
    ],
    [
      'invalid multi-enum option',
      (document: ReturnType<typeof richImportDocument>) => {
        const value = document.project.items[0]!.values.find((entry) => entry.optionIds.length)!;
        value.optionIds = [uuid(999)];
      },
    ],
    [
      'does not match field',
      (document: ReturnType<typeof richImportDocument>) => {
        const value = document.project.items[0]!.values[0]!;
        value.integerValue = 3;
      },
    ],
  ])('rejects an import with %s', (message, mutate) => {
    const document = richImportDocument();
    mutate(document);
    expect(() => parseProjectImport(JSON.stringify(document))).toThrow(message);
  });
});

describe('ProjectImportsService', () => {
  it('creates the imported data inside one transaction and keeps fresh access records', async () => {
    const tx = {
      project: {
        create: vi.fn().mockResolvedValue({ id: 'new-project', name: 'Imported project' }),
      },
      projectRole: { createMany: vi.fn().mockResolvedValue({ count: 4 }) },
      projectRolePermission: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectMembership: {
        create: vi.fn().mockResolvedValue({ id: 'new-membership' }),
      },
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
      entityType: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      fieldDefinition: { createMany: vi.fn() },
      fieldOption: { createMany: vi.fn() },
      breakdownItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      fieldValue: { createMany: vi.fn() },
      fieldValueOption: { createMany: vi.fn() },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const transaction = vi.fn((callback: (client: typeof tx) => unknown) => callback(tx));
    const service = new ProjectImportsService({ $transaction: transaction } as never);

    const result = await service.importAsNewProject(
      '00000000-0000-4000-8000-000000000010',
      JSON.stringify(importDocument()),
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.projectRole.createMany).toHaveBeenCalledOnce();
    expect(tx.projectMembership.create).toHaveBeenCalledOnce();
    expect(tx.entityType.createMany).toHaveBeenCalledOnce();
    expect(tx.breakdownItem.createMany).toHaveBeenCalledOnce();
    expect(result.counts).toMatchObject({ entityTypes: 1, items: 1, fields: 0, values: 0 });
  });

  it('validates before opening a database transaction', async () => {
    const transaction = vi.fn();
    const service = new ProjectImportsService({ $transaction: transaction } as never);

    await expect(service.importAsNewProject('user', '{broken')).rejects.toThrow('not valid JSON');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('imports options and typed values while warning about omitted binary metadata', async () => {
    const tx = {
      project: {
        create: vi.fn().mockResolvedValue({ id: 'new-project', name: 'Imported project' }),
      },
      projectRole: { createMany: vi.fn().mockResolvedValue({ count: 4 }) },
      projectRolePermission: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      projectMembership: { create: vi.fn().mockResolvedValue({ id: 'new-membership' }) },
      projectWorkspaceDefault: { create: vi.fn().mockResolvedValue({}) },
      projectMembershipWorkspaceLayout: { create: vi.fn().mockResolvedValue({}) },
      entityType: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      fieldDefinition: { createMany: vi.fn().mockResolvedValue({ count: 11 }) },
      fieldOption: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      breakdownItem: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      fieldValue: { createMany: vi.fn().mockResolvedValue({ count: 8 }) },
      fieldValueOption: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      activityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const result = await new ProjectImportsService(prisma as never).importAsNewProject(
      uuid(800),
      JSON.stringify(richImportDocument()),
    );

    expect(result.counts).toEqual({ entityTypes: 2, fields: 11, options: 2, items: 2, values: 8 });
    expect(result.warnings).toHaveLength(3);
    expect(tx.fieldOption.createMany).toHaveBeenCalled();
    expect(tx.fieldValue.createMany).toHaveBeenCalled();
    expect(tx.fieldValueOption.createMany).toHaveBeenCalled();
  });
});
