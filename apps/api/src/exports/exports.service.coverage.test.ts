import { describe, expect, it, vi } from 'vitest';
import { csvCell, ExportsService } from './exports.service';

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let output = '';
  for await (const chunk of chunks) output += chunk;
  return output;
}

function serviceWith(prisma: object) {
  const permissions = { assert: vi.fn().mockResolvedValue(undefined) };
  return { service: new ExportsService(prisma as never, permissions as never), permissions };
}

describe('ExportsService CSV generation', () => {
  it('serializes every supported stored field representation in stable field order', async () => {
    const date = new Date('2026-07-22T00:00:00.000Z');
    const fields = [
      'text',
      'integer',
      'float',
      'boolean',
      'date',
      'enum',
      'multi',
      'file',
      'empty',
    ].map((id) => ({ id, name: id }));
    const values = [
      {
        fieldId: 'text',
        textValue: 'hello, "world"',
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'integer',
        textValue: null,
        integerValue: 7,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'float',
        textValue: null,
        integerValue: null,
        floatValue: 1.5,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'boolean',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: false,
        dateValue: null,
        option: null,
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'date',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: date,
        option: null,
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'enum',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: { label: 'Approved' },
        options: [],
        storageObject: null,
      },
      {
        fieldId: 'multi',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [{ option: { label: 'A' } }, { option: { label: 'B' } }],
        storageObject: null,
      },
      {
        fieldId: 'file',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [],
        storageObject: { originalFilename: 'plate.exr' },
      },
      {
        fieldId: 'empty',
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        option: null,
        options: [],
        storageObject: null,
      },
    ];
    const prisma = {
      entityType: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ pluralName: 'Shot / Elements' }),
      },
      fieldDefinition: { findMany: vi.fn().mockResolvedValue(fields) },
      breakdownItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'item',
            parentId: 'parent',
            parent: { title: 'Parent' },
            displayCode: 'SH-01',
            title: '=danger',
            description: 'line one\nline two',
            values,
          },
          {
            id: 'empty-item',
            parentId: null,
            parent: null,
            displayCode: null,
            title: 'Empty',
            description: null,
            values: [],
          },
        ]),
      },
    };
    const { service, permissions } = serviceWith(prisma);
    const result = await service.levelCsv('user', 'project', 'type');
    const content = await collect(result.content);

    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'read_project');
    expect(result.filename).toBe('shot-elements.csv');
    expect(content).toContain('2026-07-22');
    expect(content).toContain('Approved');
    expect(content).toContain('A; B');
    expect(content).toContain('plate.exr');
    expect(content).toContain("'=danger");
    expect(content).toMatch(/\r\n$/);
  });

  it('uses a safe fallback filename and supports an empty level', async () => {
    const prisma = {
      entityType: { findFirstOrThrow: vi.fn().mockResolvedValue({ pluralName: '' }) },
      fieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      breakdownItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { service } = serviceWith(prisma);
    const result = await service.levelCsv('user', 'project', 'type');
    expect(result.filename).toBe('items.csv');
    await expect(collect(result.content)).resolves.toBe(
      'id,parent_id,parent_title,display_code,title,description\r\n',
    );
  });

  it('renders primitive, date, object, null, and quote-sensitive cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(csvCell({ answer: 42 })).toBe('"{""answer"":42}"');
    expect(csvCell('plain')).toBe('plain');
  });
});

describe('ExportsService portable project JSON', () => {
  it('projects nested domain records and converts bigint storage sizes', async () => {
    const now = new Date('2026-07-22T01:02:03.000Z');
    const storage = {
      id: 'storage',
      kind: 'FILE',
      originalFilename: 'asset.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 42n,
      width: 1920,
      height: 1080,
      durationMs: 500,
      version: 2,
      createdAt: now,
    };
    const project = {
      id: 'project',
      name: 'Production',
      description: 'Desc',
      version: 2,
      revision: 9,
      createdAt: now,
      updatedAt: now,
    };
    const roles = [
      {
        id: 'role',
        name: 'editor',
        description: null,
        isOwner: false,
        position: 'a',
        version: 1,
        permissions: [{ permission: 'read_project' }, { permission: 'manage_items' }],
      },
    ];
    const entityTypes = [
      {
        id: 'type',
        parentTypeId: null,
        singularName: 'Shot',
        pluralName: 'Shots',
        displayPrefix: 'SH',
        level: 1,
        position: 'a',
        enabled: true,
        version: 1,
      },
    ];
    const fields = [
      {
        id: 'field',
        entityTypeId: 'type',
        name: 'Status',
        key: 'status',
        type: 'ENUM',
        required: false,
        position: 'a',
        configuration: {},
        version: 1,
        options: [{ id: 'option', label: 'Done', color: '#0f0', position: 'a' }],
      },
    ];
    const items = [
      {
        id: 'item',
        entityTypeId: 'type',
        parentId: null,
        title: 'Shot 1',
        displayCode: 'SH-1',
        description: null,
        position: 'a',
        version: 3,
        createdAt: now,
        updatedAt: now,
        values: [
          {
            id: 'value',
            fieldId: 'field',
            textValue: null,
            integerValue: null,
            floatValue: null,
            booleanValue: null,
            dateValue: null,
            optionId: 'option',
            storageObjectId: null,
            options: [{ optionId: 'option' }],
          },
        ],
        sourceReferences: [
          {
            id: 'reference',
            sourceDocumentId: 'document',
            startPage: 1,
            endPage: 2,
            position: 'a',
          },
        ],
      },
    ];
    const sourceDocuments = [
      {
        id: 'document',
        title: 'Script',
        pageCount: 10,
        storageObjectId: 'storage',
        version: 1,
        createdAt: now,
        storageObject: storage,
      },
    ];
    const { service } = serviceWith({
      project: { findUniqueOrThrow: vi.fn().mockResolvedValue(project) },
      projectRole: { findMany: vi.fn().mockResolvedValue(roles) },
      entityType: { findMany: vi.fn().mockResolvedValue(entityTypes) },
      fieldDefinition: { findMany: vi.fn().mockResolvedValue(fields) },
      breakdownItem: { findMany: vi.fn().mockResolvedValue(items) },
      sourceDocument: { findMany: vi.fn().mockResolvedValue(sourceDocuments) },
      storageObject: { findMany: vi.fn().mockResolvedValue([storage]) },
    });

    interface PortableExport {
      schemaVersion: number;
      exportedAt: string;
      project: {
        roles: Array<{ permissions: string[] }>;
        fields: Array<{ options: object[] }>;
        items: Array<{
          values: Array<{ optionIds: string[] }>;
          sourceReferences: Array<{ startPage: number }>;
        }>;
        sourceDocuments: Array<{ storageObject: { sizeBytes: number } }>;
        storageObjects: Array<{ sizeBytes: number }>;
      };
    }
    const parsed = JSON.parse(
      await collect(await service.projectJson('user', 'project')),
    ) as unknown as PortableExport;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toEqual(expect.any(String));
    expect(parsed.project.roles).toMatchObject([{ permissions: ['read_project', 'manage_items'] }]);
    expect(parsed.project.fields).toMatchObject([
      { options: [{ id: 'option', label: 'Done', color: '#0f0', position: 'a' }] },
    ]);
    expect(parsed.project.items).toMatchObject([
      {
        values: [{ optionIds: ['option'] }],
        sourceReferences: [{ startPage: 1 }],
      },
    ]);
    expect(parsed.project.sourceDocuments).toMatchObject([{ storageObject: { sizeBytes: 42 } }]);
    expect(parsed.project.storageObjects).toMatchObject([{ sizeBytes: 42 }]);
  });
});
