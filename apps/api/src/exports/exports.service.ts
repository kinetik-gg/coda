import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { projectJsonSnapshot } from './project-json-snapshot.stream';
import { SnapshotExportAdmission } from './snapshot-export-admission';

export interface ProjectJsonExport {
  content: AsyncGenerator<string>;
  release: () => void;
}

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
  private readonly snapshotAdmission = new SnapshotExportAdmission();

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async levelCsv(userId: string, projectId: string, entityTypeId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const [type, fields] = await Promise.all([
      this.prisma.entityType.findFirstOrThrow({ where: { id: entityTypeId, projectId } }),
      this.prisma.fieldDefinition.findMany({
        where: { entityTypeId, deletedAt: null },
        orderBy: { position: 'asc' },
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
    const content = this.csvChunks(projectId, entityTypeId, fields, header);
    return {
      filename: `${type.pluralName.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'items'}.csv`,
      content,
    };
  }

  private async *csvChunks(
    projectId: string,
    entityTypeId: string,
    fields: Array<{ id: string; name: string }>,
    header: string[],
  ): AsyncGenerator<string> {
    yield `${header.map(csvCell).join(',')}\r\n`;
    let cursor: string | undefined;
    do {
      const items = await this.prisma.breakdownItem.findMany({
        where: { projectId, entityTypeId, deletedAt: null },
        include: {
          values: {
            include: { option: true, options: { include: { option: true } }, storageObject: true },
          },
          parent: { select: { id: true, title: true } },
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const item of items) {
        const values = new Map(item.values.map((value) => [value.fieldId, value]));
        const custom = fields.map((field) => this.exportFieldValue(values.get(field.id)));
        yield `${[
          item.id,
          item.parentId,
          item.parent?.title,
          item.displayCode,
          item.title,
          item.description,
          ...custom,
        ]
          .map(csvCell)
          .join(',')}\r\n`;
      }
      cursor = items.length === 500 ? items.at(-1)?.id : undefined;
    } while (cursor);
  }

  private exportFieldValue(
    value:
      | {
          textValue: string | null;
          integerValue: number | null;
          floatValue: number | null;
          booleanValue: boolean | null;
          dateValue: Date | null;
          option: { label: string } | null;
          options: Array<{ option: { label: string } }>;
          storageObject: { originalFilename: string } | null;
        }
      | undefined,
  ): string | number | boolean {
    if (!value) return '';
    if (value.textValue !== null) return value.textValue;
    if (value.integerValue !== null) return value.integerValue;
    if (value.floatValue !== null) return value.floatValue;
    if (value.booleanValue !== null) return value.booleanValue;
    if (value.dateValue !== null) return value.dateValue.toISOString().slice(0, 10);
    if (value.option) return value.option.label;
    if (value.options.length) return value.options.map((entry) => entry.option.label).join('; ');
    return value.storageObject?.originalFilename ?? '';
  }

  async projectJson(userId: string, projectId: string): Promise<ProjectJsonExport> {
    await this.permissions.assert(userId, projectId, 'read_project');
    const release = this.snapshotAdmission.acquire(userId);
    return { content: projectJsonSnapshot(this.prisma, projectId), release };
  }
}
