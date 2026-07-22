import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);
  if (typeof value === 'string' && /^[\s\u200b\ufeff]*[=+\-@]/iu.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async levelCsv(userId: string, projectId: string, entityTypeId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const [type, fields, items] = await Promise.all([
      this.prisma.entityType.findFirstOrThrow({ where: { id: entityTypeId, projectId } }),
      this.prisma.fieldDefinition.findMany({
        where: { entityTypeId, deletedAt: null },
        orderBy: { position: 'asc' },
      }),
      this.prisma.breakdownItem.findMany({
        where: { projectId, entityTypeId, deletedAt: null },
        include: {
          values: {
            include: { option: true, options: { include: { option: true } }, storageObject: true },
          },
          parent: { select: { id: true, title: true } },
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const header = [
      'id',
      'parent_id',
      'parent_title',
      'display_code',
      'title',
      'description',
      ...fields.map((field) => field.name),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const item of items) {
      const values = new Map(item.values.map((value) => [value.fieldId, value]));
      const custom = fields.map((field) => {
        const value = values.get(field.id);
        if (!value) return '';
        if (value.textValue !== null) return value.textValue;
        if (value.integerValue !== null) return value.integerValue;
        if (value.floatValue !== null) return value.floatValue;
        if (value.booleanValue !== null) return value.booleanValue;
        if (value.dateValue !== null) return value.dateValue.toISOString().slice(0, 10);
        if (value.option) return value.option.label;
        if (value.options.length)
          return value.options.map((entry) => entry.option.label).join('; ');
        if (value.storageObject) return value.storageObject.originalFilename;
        return '';
      });
      lines.push(
        [
          item.id,
          item.parentId,
          item.parent?.title,
          item.displayCode,
          item.title,
          item.description,
          ...custom,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return {
      filename: `${type.pluralName.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'items'}.csv`,
      content: `${lines.join('\r\n')}\r\n`,
    };
  }

  async projectJson(userId: string, projectId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        roles: {
          where: { archivedAt: null },
          include: { permissions: true },
          orderBy: { position: 'asc' },
        },
        entityTypes: { orderBy: { level: 'asc' } },
        fields: {
          where: { deletedAt: null },
          include: { options: { where: { archivedAt: null }, orderBy: { position: 'asc' } } },
          orderBy: { position: 'asc' },
        },
        items: {
          where: { deletedAt: null },
          include: {
            values: { include: { options: true } },
            sourceReferences: { orderBy: { position: 'asc' } },
          },
          orderBy: { position: 'asc' },
        },
        sourceDocuments: { where: { deletedAt: null }, include: { storageObject: true } },
        storageObjects: { where: { deletedAt: null } },
      },
    });

    const storageMetadata = (storage: (typeof project.storageObjects)[number]) => ({
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
    });

    const portableProject = {
      id: project.id,
      name: project.name,
      description: project.description,
      version: project.version,
      revision: project.revision,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      roles: project.roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isOwner: role.isOwner,
        position: role.position,
        version: role.version,
        permissions: role.permissions.map((entry) => entry.permission),
      })),
      entityTypes: project.entityTypes.map((type) => ({
        id: type.id,
        parentTypeId: type.parentTypeId,
        singularName: type.singularName,
        pluralName: type.pluralName,
        displayPrefix: type.displayPrefix,
        level: type.level,
        position: type.position,
        enabled: type.enabled,
        version: type.version,
      })),
      fields: project.fields.map((field) => ({
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
      })),
      items: project.items.map((item) => ({
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
      })),
      sourceDocuments: project.sourceDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        pageCount: document.pageCount,
        storageObjectId: document.storageObjectId,
        version: document.version,
        createdAt: document.createdAt,
        storageObject: storageMetadata(document.storageObject),
      })),
      storageObjects: project.storageObjects.map(storageMetadata),
    };

    return JSON.stringify(
      { schemaVersion: 1, exportedAt: new Date().toISOString(), project: portableProject },
      (_key, value: unknown) => (typeof value === 'bigint' ? Number(value) : value),
      2,
    );
  }
}
