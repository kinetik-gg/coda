import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FieldType as ContractFieldType, FieldValueInput, ItemFilter } from '@coda/contracts';
import { evenlySpacedRanks, rankBetween } from '../common/rank';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { buildTypedFilter as typedFilterForField } from './breakdown-filter';
import {
  assertFieldKeyAvailable,
  assertOptionsAllowed,
  reconcileFieldOptions,
} from './breakdown-field-options';
import { fieldTypeMap, storageReferenceForValue, valueData } from './breakdown-field-value';
import { rankForMove as rankForOrderingMove } from './breakdown-ordering';
import type {
  BreakdownTransaction as Transaction,
  FieldOptionCreateInput,
  FieldOptionUpdateInput,
} from './breakdown.types';

@Injectable()
export class BreakdownService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async addEntityType(
    userId: string,
    projectId: string,
    input: { singularName: string; pluralName: string; displayPrefix?: string | null },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_entity_types');
    return this.prisma.$transaction(async (tx) => {
      const levels = await tx.entityType.findMany({
        where: { projectId },
        orderBy: { level: 'asc' },
      });
      if (levels.length >= 3)
        throw new ConflictException('A project can have at most three hierarchy levels');
      const parent = levels.at(-1);
      const entityType = await tx.entityType.create({
        data: {
          projectId,
          parentTypeId: parent?.id,
          level: levels.length + 1,
          singularName: input.singularName,
          pluralName: input.pluralName,
          displayPrefix: input.displayPrefix,
          position: rankBetween(parent?.position, null),
        },
      });
      await this.touch(tx, projectId, userId, {
        action: 'CREATED',
        resourceType: 'entity_type',
        resourceId: entityType.id,
      });
      return entityType;
    });
  }

  async updateEntityType(
    userId: string,
    projectId: string,
    entityTypeId: string,
    input: {
      singularName?: string;
      pluralName?: string;
      displayPrefix?: string | null;
      version: number;
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_entity_types');
    const result = await this.prisma.entityType.updateMany({
      where: { id: entityTypeId, projectId, version: input.version },
      data: {
        ...(input.singularName !== undefined ? { singularName: input.singularName } : {}),
        ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
        ...(input.displayPrefix !== undefined ? { displayPrefix: input.displayPrefix } : {}),
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Hierarchy level has changed');
    return this.prisma.entityType.findUniqueOrThrow({ where: { id: entityTypeId } });
  }

  async removeDeepestEntityType(userId: string, projectId: string, entityTypeId: string) {
    await this.permissions.assert(userId, projectId, 'manage_entity_types');
    return this.prisma.$transaction(async (tx) => {
      const levels = await tx.entityType.findMany({
        where: { projectId },
        orderBy: { level: 'asc' },
      });
      const target = levels.at(-1);
      if (levels.length === 1 || target?.id !== entityTypeId)
        throw new ConflictException('Only an empty deepest level may be removed');
      const [items, fields] = await Promise.all([
        tx.breakdownItem.count({ where: { entityTypeId } }),
        tx.fieldDefinition.count({ where: { entityTypeId } }),
      ]);
      if (items || fields)
        throw new ConflictException(
          'Clear active and trashed items and fields before removing this level',
        );
      await tx.entityType.delete({ where: { id: entityTypeId } });
      await this.touch(tx, projectId, userId, {
        action: 'DELETED',
        resourceType: 'entity_type',
        resourceId: entityTypeId,
      });
      return { removed: true };
    });
  }

  async listItems(
    userId: string,
    projectId: string,
    query: {
      entityTypeId: string;
      parentId?: string | null;
      cursor?: string;
      limit: number;
      sort: string;
      direction: 'asc' | 'desc';
      search?: string;
      filters: ItemFilter[];
    },
  ) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const filterFields = query.filters.length
      ? await this.prisma.fieldDefinition.findMany({
          where: {
            id: { in: [...new Set(query.filters.map((filter) => filter.fieldId))] },
            projectId,
            entityTypeId: query.entityTypeId,
            deletedAt: null,
          },
          include: { options: { where: { archivedAt: null } } },
        })
      : [];
    if (filterFields.length !== new Set(query.filters.map((filter) => filter.fieldId)).size)
      throw new BadRequestException('A filter field does not belong to this hierarchy level');
    const typedFilters = query.filters.flatMap((filter) => {
      const field = filterFields.find((candidate) => candidate.id === filter.fieldId)!;
      return this.buildTypedFilter(field, filter);
    });
    const orderField =
      query.sort === 'title'
        ? 'title'
        : query.sort === 'code'
          ? 'displayCode'
          : query.sort === 'created_at'
            ? 'createdAt'
            : query.sort === 'updated_at'
              ? 'updatedAt'
              : 'position';
    const orderBy = [
      { [orderField]: query.direction },
      { id: query.direction },
    ] as Prisma.BreakdownItemOrderByWithRelationInput[];
    const rows = await this.prisma.breakdownItem.findMany({
      where: {
        projectId,
        entityTypeId: query.entityTypeId,
        deletedAt: null,
        ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { displayCode: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(typedFilters.length ? { AND: typedFilters } : {}),
      },
      include: {
        _count: { select: { children: { where: { deletedAt: null } } } },
        parent: {
          select: {
            id: true,
            parentId: true,
            entityTypeId: true,
            displayCode: true,
            title: true,
            parent: {
              select: {
                id: true,
                parentId: true,
                entityTypeId: true,
                displayCode: true,
                title: true,
              },
            },
          },
        },
        values: {
          include: { option: true, options: { include: { option: true } }, storageObject: true },
        },
        sourceReferences: { orderBy: { position: 'asc' } },
      },
      orderBy,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? this.encodeCursor(data.at(-1)!.id) : null };
  }

  async createItem(
    userId: string,
    projectId: string,
    input: {
      entityTypeId: string;
      parentId?: string | null;
      title: string;
      displayCode?: string | null;
      description?: string | null;
      beforeId?: string;
      afterId?: string;
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    return this.prisma.$transaction(async (tx) => {
      const type = await tx.entityType.findFirst({
        where: { id: input.entityTypeId, projectId, enabled: true },
      });
      if (!type) throw new NotFoundException('Hierarchy level not found');
      await this.validateParent(tx, projectId, type.parentTypeId, input.parentId ?? null);
      const siblings = await tx.breakdownItem.findMany({
        where: {
          projectId,
          entityTypeId: input.entityTypeId,
          parentId: input.parentId ?? null,
          deletedAt: null,
        },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const position = await this.rankForMove(
        siblings,
        input.beforeId,
        input.afterId,
        async (ranks) => {
          await Promise.all(
            ranks.map(({ id, position: rank }) =>
              tx.breakdownItem.update({ where: { id }, data: { position: rank } }),
            ),
          );
        },
      );
      const item = await tx.breakdownItem.create({
        data: {
          projectId,
          entityTypeId: input.entityTypeId,
          parentId: input.parentId ?? null,
          title: input.title,
          displayCode: input.displayCode,
          description: input.description,
          position,
        },
      });
      await this.touch(tx, projectId, userId, {
        action: 'CREATED',
        resourceType: 'breakdown_item',
        resourceId: item.id,
      });
      return item;
    });
  }

  async updateItem(
    userId: string,
    projectId: string,
    itemId: string,
    input: {
      title?: string;
      displayCode?: string | null;
      description?: string | null;
      parentId?: string | null;
      version: number;
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    const item = await this.prisma.breakdownItem.findFirst({
      where: { id: itemId, projectId, deletedAt: null },
      include: { entityType: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (input.parentId !== undefined)
      await this.validateParent(
        this.prisma,
        projectId,
        item.entityType.parentTypeId,
        input.parentId,
      );
    const result = await this.prisma.breakdownItem.updateMany({
      where: { id: itemId, version: input.version, deletedAt: null },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.displayCode !== undefined ? { displayCode: input.displayCode } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Item has changed; refresh and retry');
    await this.prisma.project.update({
      where: { id: projectId },
      data: { revision: { increment: 1 } },
    });
    return this.prisma.breakdownItem.findUniqueOrThrow({ where: { id: itemId } });
  }

  async reorderItem(
    userId: string,
    projectId: string,
    itemId: string,
    input: {
      beforeId?: string | null;
      afterId?: string | null;
      parentId?: string | null;
      version: number;
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.breakdownItem.findFirst({
        where: { id: itemId, projectId, deletedAt: null },
        include: { entityType: true },
      });
      if (!item) throw new NotFoundException('Item not found');
      if (item.version !== input.version)
        throw new ConflictException('Item has changed; refresh and retry');

      const parentId = input.parentId !== undefined ? input.parentId : item.parentId;
      await this.validateParent(tx, projectId, item.entityType.parentTypeId, parentId);
      const siblings = await tx.breakdownItem.findMany({
        where: {
          projectId,
          entityTypeId: item.entityTypeId,
          parentId,
          deletedAt: null,
          id: { not: itemId },
        },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const position = await this.rankForMove(
        siblings,
        input.beforeId,
        input.afterId,
        async (ranks) => {
          await Promise.all(
            ranks.map(({ id, position: rank }) =>
              tx.breakdownItem.update({ where: { id }, data: { position: rank } }),
            ),
          );
        },
      );
      const result = await tx.breakdownItem.updateMany({
        where: { id: itemId, projectId, version: input.version, deletedAt: null },
        data: { parentId, position, version: { increment: 1 } },
      });
      if (!result.count) throw new ConflictException('Item has changed; refresh and retry');
      await this.touch(tx, projectId, userId, {
        action: 'UPDATED',
        resourceType: 'breakdown_item',
        resourceId: itemId,
      });
      return tx.breakdownItem.findUniqueOrThrow({ where: { id: itemId } });
    });
  }

  async createField(
    userId: string,
    projectId: string,
    input: {
      entityTypeId: string;
      name: string;
      key: string;
      type: ContractFieldType;
      required: boolean;
      configuration?: Record<string, unknown>;
      options?: FieldOptionCreateInput[];
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_fields');
    assertOptionsAllowed(fieldTypeMap[input.type], input.options);
    return this.prisma.$transaction(async (tx) => {
      const entityType = await tx.entityType.findFirst({
        where: { id: input.entityTypeId, projectId },
      });
      if (!entityType) throw new NotFoundException('Hierarchy level not found');
      await assertFieldKeyAvailable(tx, input.entityTypeId, input.key);
      const last = await tx.fieldDefinition.findFirst({
        where: { entityTypeId: input.entityTypeId, deletedAt: null },
        orderBy: { position: 'desc' },
      });
      const optionRanks = evenlySpacedRanks(input.options?.length ?? 0);
      const field = await tx.fieldDefinition.create({
        data: {
          projectId,
          entityTypeId: input.entityTypeId,
          name: input.name,
          key: input.key,
          type: fieldTypeMap[input.type],
          required: input.required,
          configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
          position: rankBetween(last?.position, null),
          ...(input.options?.length
            ? {
                options: {
                  create: input.options.map((option, index) => ({
                    label: option.label,
                    color: option.color,
                    position: optionRanks[index]!,
                  })),
                },
              }
            : {}),
        },
        include: {
          options: { where: { archivedAt: null }, orderBy: { position: 'asc' } },
        },
      });
      await this.touch(tx, projectId, userId, {
        action: 'CREATED',
        resourceType: 'field_definition',
        resourceId: field.id,
      });
      return field;
    });
  }

  async listFields(userId: string, projectId: string, entityTypeId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    return this.prisma.fieldDefinition.findMany({
      where: { projectId, entityTypeId, deletedAt: null },
      include: { options: { where: { archivedAt: null }, orderBy: { position: 'asc' } } },
      orderBy: { position: 'asc' },
    });
  }

  async getField(userId: string, projectId: string, fieldId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const field = await this.prisma.fieldDefinition.findFirst({
      where: { id: fieldId, projectId, deletedAt: null },
      include: { options: { where: { archivedAt: null }, orderBy: { position: 'asc' } } },
    });
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  async updateField(
    userId: string,
    projectId: string,
    fieldId: string,
    input: {
      name?: string;
      key?: string;
      required?: boolean;
      configuration?: Record<string, unknown>;
      options?: FieldOptionUpdateInput[];
      version: number;
    },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_fields');
    return this.prisma.$transaction(async (tx) => {
      const field = await tx.fieldDefinition.findFirst({
        where: { id: fieldId, projectId, deletedAt: null },
        include: { options: true },
      });
      if (!field) throw new NotFoundException('Field not found');
      if (field.version !== input.version) {
        throw new ConflictException('Field has changed; refresh and retry');
      }
      assertOptionsAllowed(field.type, input.options);
      if (input.key !== undefined && input.key !== field.key) {
        await assertFieldKeyAvailable(tx, field.entityTypeId, input.key, fieldId);
      }

      if (input.options !== undefined) {
        await reconcileFieldOptions(tx, fieldId, field.options, input.options);
      }

      const result = await tx.fieldDefinition.updateMany({
        where: { id: fieldId, projectId, version: input.version, deletedAt: null },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.key !== undefined ? { key: input.key } : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.configuration !== undefined
            ? { configuration: input.configuration as Prisma.InputJsonValue }
            : {}),
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException('Field has changed; refresh and retry');
      await this.touch(tx, projectId, userId, {
        action: 'UPDATED',
        resourceType: 'field_definition',
        resourceId: fieldId,
      });
      return tx.fieldDefinition.findUniqueOrThrow({
        where: { id: fieldId },
        include: {
          options: { where: { archivedAt: null }, orderBy: { position: 'asc' } },
        },
      });
    });
  }

  async reorderField(
    userId: string,
    projectId: string,
    fieldId: string,
    input: { beforeId?: string | null; afterId?: string | null; version: number },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_fields');
    return this.prisma.$transaction(async (tx) => {
      const field = await tx.fieldDefinition.findFirst({
        where: { id: fieldId, projectId, deletedAt: null },
      });
      if (!field) throw new NotFoundException('Field not found');
      if (field.version !== input.version)
        throw new ConflictException('Field has changed; refresh and retry');
      const siblings = await tx.fieldDefinition.findMany({
        where: {
          projectId,
          entityTypeId: field.entityTypeId,
          deletedAt: null,
          id: { not: fieldId },
        },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const position = await this.rankForMove(
        siblings,
        input.beforeId,
        input.afterId,
        async (ranks) => {
          await Promise.all(
            ranks.map(({ id, position: rank }) =>
              tx.fieldDefinition.update({ where: { id }, data: { position: rank } }),
            ),
          );
        },
      );
      const result = await tx.fieldDefinition.updateMany({
        where: { id: fieldId, projectId, version: input.version, deletedAt: null },
        data: { position, version: { increment: 1 } },
      });
      if (!result.count) throw new ConflictException('Field has changed; refresh and retry');
      await this.touch(tx, projectId, userId, {
        action: 'UPDATED',
        resourceType: 'field_definition',
        resourceId: fieldId,
      });
      return tx.fieldDefinition.findUniqueOrThrow({
        where: { id: fieldId },
        include: {
          options: { where: { archivedAt: null }, orderBy: { position: 'asc' } },
        },
      });
    });
  }

  async setFieldValue(
    userId: string,
    projectId: string,
    itemId: string,
    fieldId: string,
    input: { value: FieldValueInput | null; itemVersion: number },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    return this.prisma.$transaction(async (tx) => {
      const [item, field] = await Promise.all([
        tx.breakdownItem.findFirst({
          where: { id: itemId, projectId, version: input.itemVersion, deletedAt: null },
        }),
        tx.fieldDefinition.findFirst({
          where: { id: fieldId, projectId, deletedAt: null },
          include: { options: { where: { archivedAt: null } } },
        }),
      ]);
      if (!item) throw new ConflictException('Item has changed; refresh and retry');
      if (!field || field.entityTypeId !== item.entityTypeId)
        throw new BadRequestException('Field does not belong to this item type');
      if (input.value === null) {
        if (field.required) throw new BadRequestException('This field is required');
        await tx.fieldValue.deleteMany({ where: { itemId, fieldId } });
      } else {
        if (fieldTypeMap[input.value.type] !== field.type)
          throw new BadRequestException('Value type does not match field definition');
        const storageReference = storageReferenceForValue(input.value);
        if (storageReference) {
          const storageObject = await tx.storageObject.findFirst({
            where: {
              id: storageReference.storageObjectId,
              projectId,
              kind: storageReference.kind,
              status: 'READY',
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!storageObject) {
            throw new BadRequestException(
              'Storage object is unavailable or does not match the field type',
            );
          }
        }
        const data = valueData(
          input.value,
          field.options.map((option) => option.id),
        );
        await tx.fieldValue.upsert({
          where: { itemId_fieldId: { itemId, fieldId } },
          create: {
            itemId,
            fieldId,
            ...data.scalar,
            ...(data.optionIds
              ? { options: { create: data.optionIds.map((optionId) => ({ optionId })) } }
              : {}),
          },
          update: {
            textValue: null,
            integerValue: null,
            floatValue: null,
            booleanValue: null,
            dateValue: null,
            optionId: null,
            storageObjectId: null,
            options: {
              deleteMany: {},
              ...(data.optionIds
                ? { create: data.optionIds.map((optionId) => ({ optionId })) }
                : {}),
            },
            ...data.scalar,
          },
        });
      }
      const updated = await tx.breakdownItem.update({
        where: { id: itemId },
        data: { version: { increment: 1 } },
      });
      await this.touch(tx, projectId, userId, {
        action: 'UPDATED',
        resourceType: 'field_value',
        resourceId: fieldId,
      });
      return updated;
    });
  }

  private buildTypedFilter(
    field: Prisma.FieldDefinitionGetPayload<{ include: { options: true } }>,
    filter: ItemFilter,
  ): Prisma.BreakdownItemWhereInput[] {
    return typedFilterForField(field, filter);
  }

  private async rankForMove(
    siblings: Array<{ id: string; position: string }>,
    beforeId: string | null | undefined,
    afterId: string | null | undefined,
    rebalance: (ranks: Array<{ id: string; position: string }>) => Promise<void>,
  ) {
    return rankForOrderingMove(siblings, beforeId, afterId, rebalance);
  }

  private async validateParent(
    tx: Transaction | PrismaService,
    projectId: string,
    parentTypeId: string | null,
    parentId: string | null,
  ) {
    if (!parentTypeId && parentId)
      throw new BadRequestException('Top-level items cannot have a parent');
    if (parentTypeId && !parentId)
      throw new BadRequestException('This hierarchy level requires a parent');
    if (parentId) {
      const parent = await tx.breakdownItem.findFirst({
        where: { id: parentId, projectId, entityTypeId: parentTypeId!, deletedAt: null },
      });
      if (!parent) throw new BadRequestException('Parent does not match the configured hierarchy');
    }
  }

  private encodeCursor(id: string) {
    return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
  }
  private decodeCursor(cursor: string): { id: string } {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id: string };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  private async touch(
    tx: Transaction,
    projectId: string,
    actorId: string,
    event: {
      action: 'CREATED' | 'UPDATED' | 'DELETED';
      resourceType: string;
      resourceId: string;
    },
  ) {
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    await tx.activityEvent.create({
      data: { projectId, actorId, ...event },
    });
  }
}
