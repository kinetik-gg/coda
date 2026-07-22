import { Injectable } from '@nestjs/common';
import { allPermissions, type Permission } from '@coda/contracts';
import { randomUUID } from 'node:crypto';
import { ActivityAction, Prisma, type FieldType, type PrismaClient } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';
import { PrismaService } from '../prisma/prisma.service';
import { createProjectWorkspaceLayouts } from '../workspace-layouts/default-workspace-layout';
import { parseProjectImport, type ProjectImportDocument } from './project-import.schema';

type Transaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const defaultRoles: Array<{ name: string; permissions: Permission[]; isOwner?: boolean }> = [
  { name: 'owner', permissions: [...allPermissions], isOwner: true },
  {
    name: 'admin',
    permissions: allPermissions.filter((permission) => permission !== 'delete_project'),
  },
  {
    name: 'editor',
    permissions: [
      'read_project',
      'manage_items',
      'manage_source_documents',
      'manage_storage_objects',
      'comment',
    ],
  },
  { name: 'viewer', permissions: ['read_project'] },
];

function chunks<T>(entries: T[], size = 1000): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    result.push(entries.slice(index, index + size));
  }
  return result;
}

export interface ProjectImportResult {
  project: { id: string; name: string };
  counts: { entityTypes: number; fields: number; options: number; items: number; values: number };
  warnings: string[];
}

@Injectable()
export class ProjectImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async importAsNewProject(userId: string, raw: string): Promise<ProjectImportResult> {
    const document = parseProjectImport(raw);
    return this.prisma.$transaction((tx) => this.importDocument(tx, userId, document), {
      timeout: 120_000,
    });
  }

  private async importDocument(
    tx: Transaction,
    userId: string,
    document: ProjectImportDocument,
  ): Promise<ProjectImportResult> {
    const source = document.project;
    const project = await tx.project.create({
      data: { ownerUserId: userId, name: source.name, description: source.description },
      select: { id: true, name: true },
    });

    const roleRanks = evenlySpacedRanks(defaultRoles.length);
    const roleIds = defaultRoles.map(() => randomUUID());
    await tx.projectRole.createMany({
      data: defaultRoles.map((role, index) => ({
        id: roleIds[index]!,
        projectId: project.id,
        name: role.name,
        isOwner: role.isOwner ?? false,
        position: roleRanks[index]!,
      })),
    });
    await tx.projectRolePermission.createMany({
      data: defaultRoles.flatMap((role, index) =>
        role.permissions.map((permission) => ({ roleId: roleIds[index]!, permission })),
      ),
    });
    const ownerMembership = await tx.projectMembership.create({
      data: { projectId: project.id, userId, roleId: roleIds[0]! },
      select: { id: true },
    });
    await createProjectWorkspaceLayouts(tx, project.id, ownerMembership.id);

    const orderedTypes = [...source.entityTypes].sort((left, right) => left.level - right.level);
    const typeRanks = evenlySpacedRanks(orderedTypes.length);
    const typeIds = new Map(orderedTypes.map((entry) => [entry.id, randomUUID()]));
    await tx.entityType.createMany({
      data: orderedTypes.map((entry, index) => ({
        id: typeIds.get(entry.id)!,
        projectId: project.id,
        parentTypeId: entry.parentTypeId ? typeIds.get(entry.parentTypeId)! : null,
        singularName: entry.singularName,
        pluralName: entry.pluralName,
        displayPrefix: entry.displayPrefix,
        level: entry.level,
        position: typeRanks[index]!,
        enabled: entry.enabled,
      })),
    });

    const fieldIds = new Map(source.fields.map((entry) => [entry.id, randomUUID()]));
    const fieldRanks = this.ranksByGroup(source.fields, (entry) => entry.entityTypeId);
    await tx.fieldDefinition.createMany({
      data: source.fields.map((entry) => ({
        id: fieldIds.get(entry.id)!,
        projectId: project.id,
        entityTypeId: typeIds.get(entry.entityTypeId)!,
        name: entry.name,
        key: entry.key,
        type: entry.type as FieldType,
        required: entry.required,
        position: fieldRanks.get(entry.id)!,
        configuration: entry.configuration as Prisma.InputJsonValue,
      })),
    });

    const sourceOptions = source.fields.flatMap((field) =>
      field.options.map((option) => ({ ...option, fieldId: field.id })),
    );
    const optionIds = new Map(sourceOptions.map((entry) => [entry.id, randomUUID()]));
    const optionRanks = this.ranksByGroup(sourceOptions, (entry) => entry.fieldId);
    if (sourceOptions.length) {
      const optionData = sourceOptions.map((entry) => ({
        id: optionIds.get(entry.id)!,
        fieldId: fieldIds.get(entry.fieldId)!,
        label: entry.label,
        color: entry.color,
        position: optionRanks.get(entry.id)!,
      }));
      for (const batch of chunks(optionData)) await tx.fieldOption.createMany({ data: batch });
    }

    const itemIds = new Map(source.items.map((entry) => [entry.id, randomUUID()]));
    const itemRanks = this.ranksByGroup(
      source.items,
      (entry) => `${entry.entityTypeId}:${entry.parentId ?? 'root'}`,
    );
    for (const entityType of orderedTypes) {
      const entries = source.items.filter((entry) => entry.entityTypeId === entityType.id);
      if (!entries.length) continue;
      const data = entries.map((entry) => ({
        id: itemIds.get(entry.id)!,
        projectId: project.id,
        entityTypeId: typeIds.get(entry.entityTypeId)!,
        parentId: entry.parentId ? itemIds.get(entry.parentId)! : null,
        title: entry.title,
        displayCode: entry.displayCode,
        description: entry.description,
        position: itemRanks.get(entry.id)!,
      }));
      for (const batch of chunks(data)) await tx.breakdownItem.createMany({ data: batch });
    }

    const fieldById = new Map(source.fields.map((entry) => [entry.id, entry]));
    const importableValues = source.items.flatMap((item) =>
      item.values
        .filter((value) => {
          const type = fieldById.get(value.fieldId)!.type;
          return !['FILE', 'IMAGE', 'VIDEO'].includes(type) && !value.storageObjectId;
        })
        .map((value) => ({ item, value })),
    );
    const valueIds = new Map(importableValues.map(({ value }) => [value.id, randomUUID()]));
    if (importableValues.length) {
      const valueData = importableValues.map(({ item, value }) => ({
        id: valueIds.get(value.id)!,
        itemId: itemIds.get(item.id)!,
        fieldId: fieldIds.get(value.fieldId)!,
        textValue: value.textValue,
        integerValue: value.integerValue,
        floatValue: value.floatValue,
        booleanValue: value.booleanValue,
        dateValue: value.dateValue ? new Date(value.dateValue) : null,
        optionId: value.optionId ? optionIds.get(value.optionId)! : null,
      }));
      for (const batch of chunks(valueData)) await tx.fieldValue.createMany({ data: batch });
      const multiOptions = importableValues.flatMap(({ value }) =>
        value.optionIds.map((optionId) => ({
          fieldValueId: valueIds.get(value.id)!,
          optionId: optionIds.get(optionId)!,
        })),
      );
      for (const batch of chunks(multiOptions, 5000)) {
        await tx.fieldValueOption.createMany({ data: batch });
      }
    }

    await tx.activityEvent.create({
      data: {
        projectId: project.id,
        actorId: userId,
        action: ActivityAction.CREATED,
        resourceType: 'project_import',
        resourceId: project.id,
        metadata: { sourceSchemaVersion: document.schemaVersion },
      },
    });

    const omittedSourceReferences = source.items.reduce(
      (total, item) => total + item.sourceReferences.length,
      0,
    );
    const omittedFileValues = source.items.reduce(
      (total, item) =>
        total +
        item.values.filter((value) => {
          const type = fieldById.get(value.fieldId)!.type;
          return ['FILE', 'IMAGE', 'VIDEO'].includes(type) || Boolean(value.storageObjectId);
        }).length,
      0,
    );
    const warnings = [
      'Project roles and memberships were reset; you are the owner of the imported project.',
    ];
    if (source.storageObjects.length || source.sourceDocuments.length || omittedSourceReferences) {
      warnings.push(
        `Skipped ${source.storageObjects.length} storage objects, ${source.sourceDocuments.length} source documents, and ${omittedSourceReferences} source references because exported files contain metadata only.`,
      );
    }
    if (omittedFileValues) {
      warnings.push(
        `Skipped ${omittedFileValues} field values that referenced binary storage objects.`,
      );
    }
    return {
      project,
      counts: {
        entityTypes: orderedTypes.length,
        fields: source.fields.length,
        options: sourceOptions.length,
        items: source.items.length,
        values: importableValues.length,
      },
      warnings,
    };
  }

  private ranksByGroup<T extends { id: string }>(
    entries: T[],
    group: (entry: T) => string,
  ): Map<string, string> {
    const groups = new Map<string, T[]>();
    for (const entry of entries) {
      const key = group(entry);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const result = new Map<string, string>();
    for (const members of groups.values()) {
      const ranks = evenlySpacedRanks(members.length);
      members.forEach((entry, index) => result.set(entry.id, ranks[index]!));
    }
    return result;
  }
}
