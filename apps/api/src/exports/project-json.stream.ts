import type { Prisma } from '@prisma/client';

export const EXPORT_BATCH_SIZE = 500;

type ExportRow = { id: string };

type StorageMetadata = {
  id: string;
  kind: unknown;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  version: number;
  createdAt: Date;
};

function json(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'bigint' ? Number(entry) : entry,
  );
}

async function* jsonArray<T extends ExportRow>(
  loadPage: (cursor?: string) => Promise<T[]>,
  portable: (row: T) => unknown,
): AsyncGenerator<string> {
  yield '[';
  let cursor: string | undefined;
  let first = true;
  do {
    const page = await loadPage(cursor);
    for (const row of page) {
      yield `${first ? '' : ','}${json(portable(row))}`;
      first = false;
    }
    cursor = page.length === EXPORT_BATCH_SIZE ? page.at(-1)?.id : undefined;
  } while (cursor);
  yield ']';
}

function storageMetadata(storage: StorageMetadata) {
  return {
    id: storage.id,
    kind: storage.kind,
    originalFilename: storage.originalFilename,
    mimeType: storage.mimeType,
    sizeBytes: storage.sizeBytes,
    width: storage.width,
    height: storage.height,
    durationMs: storage.durationMs,
    version: storage.version,
    createdAt: storage.createdAt,
  };
}

export class ProjectJsonStream {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async *generate(projectId: string): AsyncGenerator<string> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        version: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const metadata = {
      id: project.id,
      name: project.name,
      description: project.description,
      version: project.version,
      revision: project.revision,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    yield `{"schemaVersion":1,"exportedAt":${json(new Date().toISOString())},"project":{`;
    yield Object.entries(metadata)
      .map(([key, value]) => `${json(key)}:${json(value)}`)
      .join(',');
    yield ',"roles":';
    yield* this.roles(projectId);
    yield ',"entityTypes":';
    yield* this.entityTypes(projectId);
    yield ',"fields":';
    yield* this.fields(projectId);
    yield ',"items":';
    yield* this.items(projectId);
    yield ',"sourceDocuments":';
    yield* this.sourceDocuments(projectId);
    yield ',"storageObjects":';
    yield* this.storageObjects(projectId);
    yield '}}';
  }

  private roles(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.projectRole.findMany({
          where: { projectId, archivedAt: null },
          include: { permissions: { orderBy: { permission: 'asc' } } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isOwner: role.isOwner,
        position: role.position,
        version: role.version,
        permissions: role.permissions.map((entry) => entry.permission),
      }),
    );
  }

  private entityTypes(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.entityType.findMany({
          where: { projectId },
          orderBy: [{ level: 'asc' }, { id: 'asc' }],
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (type) => ({
        id: type.id,
        parentTypeId: type.parentTypeId,
        singularName: type.singularName,
        pluralName: type.pluralName,
        displayPrefix: type.displayPrefix,
        level: type.level,
        position: type.position,
        enabled: type.enabled,
        version: type.version,
      }),
    );
  }

  private fields(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.fieldDefinition.findMany({
          where: { projectId, deletedAt: null },
          include: {
            options: {
              where: { archivedAt: null },
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (field) => ({
        id: field.id,
        entityTypeId: field.entityTypeId,
        name: field.name,
        key: field.key,
        type: field.type,
        required: field.required,
        position: field.position,
        configuration: field.configuration,
        version: field.version,
        options: field.options.map((option) => ({
          id: option.id,
          label: option.label,
          color: option.color,
          position: option.position,
        })),
      }),
    );
  }

  private items(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.breakdownItem.findMany({
          where: { projectId, deletedAt: null },
          include: {
            values: {
              where: { field: { deletedAt: null } },
              include: { options: { orderBy: { optionId: 'asc' } } },
              orderBy: { id: 'asc' },
            },
            sourceReferences: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
          },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (item) => ({
        id: item.id,
        entityTypeId: item.entityTypeId,
        parentId: item.parentId,
        title: item.title,
        displayCode: item.displayCode,
        description: item.description,
        position: item.position,
        version: item.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        values: item.values.map((value) => ({
          id: value.id,
          fieldId: value.fieldId,
          textValue: value.textValue,
          integerValue: value.integerValue,
          floatValue: value.floatValue,
          booleanValue: value.booleanValue,
          dateValue: value.dateValue,
          optionId: value.optionId,
          storageObjectId: value.storageObjectId,
          optionIds: value.options.map((entry) => entry.optionId),
        })),
        sourceReferences: item.sourceReferences.map((reference) => ({
          id: reference.id,
          sourceDocumentId: reference.sourceDocumentId,
          startPage: reference.startPage,
          endPage: reference.endPage,
          position: reference.position,
        })),
      }),
    );
  }

  private sourceDocuments(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.sourceDocument.findMany({
          where: { projectId, deletedAt: null },
          include: { storageObject: true },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (document) => ({
        id: document.id,
        title: document.title,
        pageCount: document.pageCount,
        storageObjectId: document.storageObjectId,
        version: document.version,
        createdAt: document.createdAt,
        storageObject: storageMetadata(document.storageObject),
      }),
    );
  }

  private storageObjects(projectId: string) {
    return jsonArray(
      (cursor) =>
        this.prisma.storageObject.findMany({
          where: { projectId, deletedAt: null },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      storageMetadata,
    );
  }
}
