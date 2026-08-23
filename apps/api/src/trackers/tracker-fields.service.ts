import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTrackerField,
  ReorderTrackerField,
  UpdateTrackerField,
  UpdateTrackerFieldOption,
} from '@coda/contracts';
import { randomUUID } from 'node:crypto';
import type { FieldType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { rankBetween, evenlySpacedRanks, rankForMove } from '../common/rank';
import { assertOptionsAllowed, reconcileRankedOptions } from '../common/field-options';
import { fieldTypeMap } from '../common/field-values';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerPermissionService } from './tracker-permission.service';
import { countMismatchOrGone } from './tracker-write-helpers';

const activeOptions = {
  options: { where: { archivedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.TrackerFieldInclude;

export type TrackerFieldView = Prisma.TrackerFieldGetPayload<{ include: typeof activeOptions }>;

function fieldWhere(trackerId: string, fieldId: string) {
  return { id: fieldId, trackerId, deletedAt: null };
}

/**
 * Field definitions for one tracker: creation and ranked ordering, optimistic-version updates
 * with per-tracker key uniqueness (a key stays reserved while its previous field sits in trash),
 * archive-to-trash deletion, and the enum-option collection with `archivedAt` semantics. Every
 * write path requires `manage_tracker_fields`; every read requires only `read_tracker`.
 */
@Injectable()
export class TrackerFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly db: DatabaseCapabilities,
  ) {}

  async create(userId: string, trackerId: string, input: CreateTrackerField) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    const type = fieldTypeMap[input.type];
    assertOptionsAllowed(type, input.options);
    return this.prisma.$transaction(async (tx) => {
      await this.assertKeyAvailable(tx, trackerId, input.key);
      const last = await tx.trackerField.findFirst({
        where: { trackerId, deletedAt: null },
        orderBy: [{ position: 'desc' }, { id: 'desc' }],
        select: { position: true },
      });
      const optionRanks = evenlySpacedRanks(input.options?.length ?? 0);
      return tx.trackerField.create({
        data: {
          trackerId,
          name: input.name,
          key: input.key,
          type,
          required: input.required,
          configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
          position: rankBetween(last?.position, null),
          ...(input.options?.length
            ? {
                options: {
                  create: input.options.map((option, index) => ({
                    label: option.label,
                    color: option.color ?? null,
                    position: optionRanks[index]!,
                  })),
                },
              }
            : {}),
        },
        include: activeOptions,
      });
    });
  }

  async list(userId: string, trackerId: string) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    return this.prisma.trackerField.findMany({
      where: { trackerId, deletedAt: null },
      include: activeOptions,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  async get(userId: string, trackerId: string, fieldId: string) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const field = await this.prisma.trackerField.findFirst({
      where: fieldWhere(trackerId, fieldId),
      include: activeOptions,
    });
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  async update(userId: string, trackerId: string, fieldId: string, input: UpdateTrackerField) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    return this.prisma.$transaction(async (tx) => {
      const field = await tx.trackerField.findFirst({
        where: fieldWhere(trackerId, fieldId),
        include: { options: true },
      });
      if (!field) throw new NotFoundException('Field not found');
      if (field.version !== input.version) {
        throw new ConflictException('Field was modified by another session');
      }
      assertOptionsAllowed(field.type as FieldType, input.options);
      if (input.key !== undefined && input.key !== field.key) {
        await this.assertKeyAvailable(tx, trackerId, input.key, fieldId);
      }
      if (input.options !== undefined) {
        await reconcileRankedOptions(tx.trackerFieldOption, fieldId, field.options, input.options);
      }
      const result = await tx.trackerField.updateMany({
        where: { ...fieldWhere(trackerId, fieldId), version: input.version },
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
      await countMismatchOrGone(result.count, 'Field', () => this.liveField(trackerId, fieldId));
      return tx.trackerField.findUniqueOrThrow({ where: { id: fieldId }, include: activeOptions });
    });
  }

  async reorder(userId: string, trackerId: string, fieldId: string, input: ReorderTrackerField) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    return this.prisma.$transaction(async (tx) => {
      const field = await tx.trackerField.findFirst({ where: fieldWhere(trackerId, fieldId) });
      if (!field) throw new NotFoundException('Field not found');
      if (field.version !== input.version) {
        throw new ConflictException('Field was modified by another session');
      }
      await this.db.acquireTransactionLock(tx, `tracker-fields:${trackerId}`);
      const siblings = await tx.trackerField.findMany({
        where: { trackerId, deletedAt: null, id: { not: fieldId } },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const position = await rankForMove(siblings, input.beforeId, input.afterId, async (ranks) => {
        await Promise.all(
          ranks.map(({ id, position: rank }) =>
            tx.trackerField.update({ where: { id }, data: { position: rank } }),
          ),
        );
      });
      const result = await tx.trackerField.updateMany({
        where: { ...fieldWhere(trackerId, fieldId), version: input.version },
        data: { position, version: { increment: 1 } },
      });
      await countMismatchOrGone(result.count, 'Field', () => this.liveField(trackerId, fieldId));
      return tx.trackerField.findUniqueOrThrow({ where: { id: fieldId }, include: activeOptions });
    });
  }

  /**
   * Archives a field into trash (the soft-deletion triple plus a version bump). The per-tracker
   * unique key keeps the key reserved; restore and purge ride with the trackers trash surface.
   */
  async archive(userId: string, trackerId: string, fieldId: string, version: number) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    const result = await this.prisma.trackerField.updateMany({
      where: { ...fieldWhere(trackerId, fieldId), version },
      data: {
        deletedAt: new Date(),
        deletedById: userId,
        deletionBatchId: randomUUID(),
        version: { increment: 1 },
      },
    });
    await countMismatchOrGone(result.count, 'Field', () => this.liveField(trackerId, fieldId));
    return { id: fieldId, archivedAt: new Date() };
  }

  async createOption(
    userId: string,
    trackerId: string,
    fieldId: string,
    input: { label: string; color?: string | null },
  ) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    return this.prisma.$transaction(async (tx) => {
      await this.enumField(tx, trackerId, fieldId);
      await this.assertOptionLabelAvailable(tx, fieldId, input.label);
      const last = await tx.trackerFieldOption.findFirst({
        where: { fieldId, archivedAt: null },
        orderBy: [{ position: 'desc' }, { id: 'desc' }],
        select: { position: true },
      });
      return tx.trackerFieldOption.create({
        data: {
          fieldId,
          label: input.label,
          color: input.color ?? null,
          position: rankBetween(last?.position, null),
        },
      });
    });
  }

  async updateOption(
    userId: string,
    trackerId: string,
    fieldId: string,
    optionId: string,
    input: UpdateTrackerFieldOption,
  ) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    return this.prisma.$transaction(async (tx) => {
      await this.enumField(tx, trackerId, fieldId);
      const option = await this.activeOption(tx, trackerId, fieldId, optionId);
      if (
        input.label !== undefined &&
        input.label.toLocaleLowerCase() !== option.label.toLocaleLowerCase()
      ) {
        await this.assertOptionLabelAvailable(tx, fieldId, input.label, optionId);
      }
      return tx.trackerFieldOption.update({
        where: { id: optionId },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.color !== undefined ? { color: input.color ?? null } : {}),
        },
      });
    });
  }

  /** Archiving keeps historical value rows intact — the FK is RESTRICT by design. */
  async archiveOption(
    userId: string,
    trackerId: string,
    fieldId: string,
    optionId: string,
  ): Promise<{ id: string; archivedAt: Date }> {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_fields');
    return this.prisma.$transaction(async (tx) => {
      await this.enumField(tx, trackerId, fieldId);
      const option = await this.activeOption(tx, trackerId, fieldId, optionId);
      const archivedAt = new Date();
      await tx.trackerFieldOption.update({ where: { id: option.id }, data: { archivedAt } });
      return { id: optionId, archivedAt };
    });
  }

  private async liveField(trackerId: string, fieldId: string) {
    return this.prisma.trackerField.findFirst({
      where: fieldWhere(trackerId, fieldId),
      select: { id: true, deletedAt: true },
    });
  }

  private async assertKeyAvailable(
    tx: Prisma.TransactionClient,
    trackerId: string,
    key: string,
    excludedFieldId?: string,
  ): Promise<void> {
    const existing = await tx.trackerField.findFirst({
      where: {
        trackerId,
        key,
        ...(excludedFieldId ? { id: { not: excludedFieldId } } : {}),
      },
      select: { id: true, deletedAt: true },
    });
    if (!existing) return;
    throw new ConflictException(
      existing.deletedAt
        ? 'That key is reserved by a field in trash; restore or purge it first'
        : 'A field with that key already exists on this tracker',
    );
  }

  private async enumField(tx: Prisma.TransactionClient, trackerId: string, fieldId: string) {
    const field = await tx.trackerField.findFirst({ where: fieldWhere(trackerId, fieldId) });
    if (!field) throw new NotFoundException('Field not found');
    if (field.type !== 'ENUM' && field.type !== 'MULTI_ENUM') {
      throw new BadRequestException('Options are only supported by enum and multi-enum fields');
    }
    return field;
  }

  private async activeOption(
    tx: Prisma.TransactionClient,
    trackerId: string,
    fieldId: string,
    optionId: string,
  ) {
    const option = await tx.trackerFieldOption.findFirst({
      where: { id: optionId, fieldId, archivedAt: null },
    });
    if (!option) throw new NotFoundException('Field option not found');
    return option;
  }

  private async assertOptionLabelAvailable(
    tx: Prisma.TransactionClient,
    fieldId: string,
    label: string,
    excludedOptionId?: string,
  ): Promise<void> {
    const clash = await tx.trackerFieldOption.findFirst({
      where: { fieldId, label: { equals: label, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash && clash.id !== excludedOptionId) {
      throw new ConflictException('An option with that label already exists on this field');
    }
  }
}
