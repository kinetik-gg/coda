import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BulkDeleteTrackerRecords,
  BulkSetTrackerRecordValues,
  CreateTrackerRecord,
  ExportTrackerRecordsQuery,
  ListTrackerRecordsQuery,
  ReorderTrackerRecord,
  SetTrackerRecordFieldValue,
  TrackerRecordFilter,
  UpdateTrackerRecord,
} from '@coda/contracts';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { rankForMove } from '../common/rank';
import { decodeCursor, encodeCursor } from '../common/cursor-codec';
import type { FilterableField } from '../common/field-filter';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { SnapshotExportAdmission } from '../exports/snapshot-export-admission';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerActivityService } from './tracker-activity.service';
import { TrackerPermissionService } from './tracker-permission.service';
import { buildTrackerRecordFilter } from './tracker-filter';
import { writeTrackerFieldValue } from './tracker-field-value';
import { countMismatchOrGone } from './tracker-write-helpers';
import {
  trackerCsvFilename,
  trackerRecordCsvChunks,
  type TrackerRecordCsvExport,
} from './tracker-record-csv.stream';

const recordInclude = {
  values: {
    orderBy: [{ fieldId: 'asc' }] as Prisma.TrackerFieldValueOrderByWithRelationInput[],
    include: { option: true, options: { include: { option: true } } },
  },
} satisfies Prisma.TrackerRecordInclude;

export type TrackerRecordView = Prisma.TrackerRecordGetPayload<{ include: typeof recordInclude }>;

const sortColumns = {
  manual: 'position',
  title: 'title',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
} as const;

/**
 * The record grid of one tracker: creation and manual rank ordering, cursor-paginated listing
 * with server-side title search, typed filters over the shared operator set, and manual/title/
 * timestamp sorts; optimistic-version updates; soft deletion to trash in bulk; and typed cell
 * writes (single + bulk) that bump the owning record's version. The same filter/search/sort
 * machinery also drives the streamed CSV export. Writes require `edit_tracker_records`; reads
 * require only `read_tracker`.
 */
@Injectable()
export class TrackerRecordsService {
  private readonly csvAdmission = new SnapshotExportAdmission('tracker record', 'Tracker record');

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly db: DatabaseCapabilities,
    private readonly activity: TrackerActivityService,
  ) {}

  async create(userId: string, trackerId: string, input: CreateTrackerRecord) {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    return this.prisma.$transaction(async (tx) => {
      const siblings = await tx.trackerRecord.findMany({
        where: { trackerId, deletedAt: null },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      const position = await rankForMove(siblings, input.beforeId, input.afterId, (ranks) =>
        this.rebalance(tx, ranks),
      );
      const created = await tx.trackerRecord.create({
        data: { trackerId, title: input.title, position },
        include: recordInclude,
      });
      await this.activity.recordChanged(trackerId, userId, 'CREATED', [created.id], tx);
      return created;
    });
  }

  async list(userId: string, trackerId: string, query: ListTrackerRecordsQuery) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const typedFilters = await this.resolveFilters(trackerId, query.filters);
    const orderColumn = sortColumns[query.sort];
    const rows = await this.prisma.trackerRecord.findMany({
      where: this.recordWhere(trackerId, query.search, typedFilters),
      include: recordInclude,
      orderBy: [
        { [orderColumn]: query.direction },
        { id: query.direction },
      ] as Prisma.TrackerRecordOrderByWithRelationInput[],
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? encodeCursor(data.at(-1)!.id) : null };
  }

  /**
   * Streams every live record matching the list endpoint's filter/search/sort vocabulary as CSV,
   * one row per record with `id`, `title`, and one column per active field in field order. The
   * admission controller caps concurrent streams per process; the caller must invoke `release`
   * once the response is done or abandoned.
   */
  async exportCsv(
    userId: string,
    trackerId: string,
    query: ExportTrackerRecordsQuery,
  ): Promise<TrackerRecordCsvExport> {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const [tracker, fields] = await Promise.all([
      this.prisma.tracker.findUniqueOrThrow({ where: { id: trackerId }, select: { name: true } }),
      this.prisma.trackerField.findMany({
        where: { trackerId, deletedAt: null },
        orderBy: { position: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    const typedFilters = await this.resolveFilters(trackerId, query.filters);
    const orderColumn = sortColumns[query.sort];
    const release = this.csvAdmission.acquire(userId);
    return {
      filename: trackerCsvFilename(tracker.name),
      content: trackerRecordCsvChunks(this.prisma, fields, {
        where: this.recordWhere(trackerId, query.search, typedFilters),
        orderBy: [
          { [orderColumn]: query.direction },
          { id: query.direction },
        ] as Prisma.TrackerRecordOrderByWithRelationInput[],
      }),
      release,
    };
  }

  async get(userId: string, trackerId: string, recordId: string) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    return this.liveRecordOrThrow(trackerId, recordId);
  }

  async update(
    userId: string,
    trackerId: string,
    recordId: string,
    input: UpdateTrackerRecord,
  ): Promise<TrackerRecordView> {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    return this.prisma.$transaction(async (tx) => {
      await this.guardStaleVersion(tx, trackerId, recordId, input.version);
      let position: string | undefined;
      if (input.beforeId !== undefined || input.afterId !== undefined) {
        position = await this.movePosition(tx, trackerId, recordId, input.beforeId, input.afterId);
      }
      const result = await tx.trackerRecord.updateMany({
        where: { id: recordId, trackerId, deletedAt: null, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(position !== undefined ? { position } : {}),
          version: { increment: 1 },
        },
      });
      await countMismatchOrGone(result.count, 'Record', () => this.findLive(trackerId, recordId));
      return tx.trackerRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: recordInclude,
      });
    });
  }

  async reorder(
    userId: string,
    trackerId: string,
    recordId: string,
    input: ReorderTrackerRecord,
  ): Promise<TrackerRecordView> {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    return this.prisma.$transaction(async (tx) => {
      await this.guardStaleVersion(tx, trackerId, recordId, input.version);
      const position = await this.movePosition(
        tx,
        trackerId,
        recordId,
        input.beforeId,
        input.afterId,
      );
      const result = await tx.trackerRecord.updateMany({
        where: { id: recordId, trackerId, deletedAt: null, version: input.version },
        data: { position, version: { increment: 1 } },
      });
      await countMismatchOrGone(result.count, 'Record', () => this.findLive(trackerId, recordId));
      return tx.trackerRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: recordInclude,
      });
    });
  }

  async setValue(
    userId: string,
    trackerId: string,
    recordId: string,
    fieldId: string,
    input: SetTrackerRecordFieldValue,
  ): Promise<TrackerRecordView> {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    return this.prisma.$transaction(async (tx) => {
      const [record, field] = await Promise.all([
        tx.trackerRecord.findFirst({ where: { id: recordId, trackerId, deletedAt: null } }),
        tx.trackerField.findFirst({
          where: { id: fieldId, trackerId, deletedAt: null },
          include: { options: { where: { archivedAt: null } } },
        }),
      ]);
      if (!record) throw new NotFoundException('Record not found');
      if (record.version !== input.recordVersion) {
        throw new ConflictException('Record was modified by another session');
      }
      if (!field) throw new BadRequestException('Field does not belong to this tracker');
      await writeTrackerFieldValue(tx, trackerId, valueTarget(recordId, field), input.value);
      await tx.trackerRecord.update({
        where: { id: recordId },
        data: { version: { increment: 1 } },
      });
      return tx.trackerRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: recordInclude,
      });
    });
  }

  /**
   * All-or-nothing bulk cell write. Every referenced field must belong to the tracker and every
   * record be live (404 otherwise); each touched record's version bumps once regardless of how
   * many of its cells changed.
   */
  async bulkSetValues(
    userId: string,
    trackerId: string,
    input: BulkSetTrackerRecordValues,
  ): Promise<{ records: TrackerRecordView[] }> {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    return this.prisma.$transaction(async (tx) => {
      const recordIds = [...new Set(input.updates.map((update) => update.recordId))];
      const fieldIds = [...new Set(input.updates.map((update) => update.fieldId))];
      const [records, fields] = await Promise.all([
        tx.trackerRecord.findMany({
          where: { id: { in: recordIds }, trackerId, deletedAt: null },
        }),
        tx.trackerField.findMany({
          where: { id: { in: fieldIds }, trackerId, deletedAt: null },
          include: { options: { where: { archivedAt: null } } },
        }),
      ]);
      if (records.length !== recordIds.length) throw new NotFoundException('Record not found');
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      for (const update of input.updates) {
        const field = fieldsById.get(update.fieldId);
        if (!field) throw new BadRequestException('Field does not belong to this tracker');
        await writeTrackerFieldValue(
          tx,
          trackerId,
          valueTarget(update.recordId, field),
          update.value,
        );
      }
      await tx.trackerRecord.updateMany({
        where: { id: { in: recordIds } },
        data: { version: { increment: 1 } },
      });
      await this.activity.recordChanged(trackerId, userId, 'UPDATED', recordIds, tx);
      const updated = await tx.trackerRecord.findMany({
        where: { id: { in: recordIds } },
        include: recordInclude,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      return { records: updated };
    });
  }

  /** Soft-deletes every live named record into trash; unknown ids are simply not reported back. */
  async bulkDelete(
    userId: string,
    trackerId: string,
    input: BulkDeleteTrackerRecords,
  ): Promise<{ deletedIds: string[]; deletionBatchId: string }> {
    await this.permissions.assert(userId, trackerId, 'edit_tracker_records');
    const live = await this.prisma.trackerRecord.findMany({
      where: { id: { in: input.ids }, trackerId, deletedAt: null },
      select: { id: true },
    });
    if (!live.length) throw new NotFoundException('Records not found');
    const deletedAt = new Date();
    const deletionBatchId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.trackerRecord.updateMany({
        where: { id: { in: live.map((record) => record.id) }, deletedAt: null },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId,
          version: { increment: 1 },
        },
      });
      await this.activity.recordChanged(
        trackerId,
        userId,
        'DELETED',
        live.map((record) => record.id),
        tx,
      );
    });
    return { deletedIds: live.map((record) => record.id), deletionBatchId };
  }

  private async rebalance(
    tx: Prisma.TransactionClient,
    ranks: Array<{ id: string; position: string }>,
  ): Promise<void> {
    await Promise.all(
      ranks.map(({ id, position }) =>
        tx.trackerRecord.update({ where: { id }, data: { position } }),
      ),
    );
  }

  private findLive(trackerId: string, recordId: string) {
    return this.prisma.trackerRecord.findFirst({
      where: { id: recordId, trackerId, deletedAt: null },
      select: { id: true, deletedAt: true },
    });
  }

  private async liveRecordOrThrow(trackerId: string, recordId: string) {
    const record = await this.prisma.trackerRecord.findFirst({
      where: { id: recordId, trackerId, deletedAt: null },
      include: recordInclude,
    });
    if (!record) throw new NotFoundException('Record not found');
    return record;
  }

  private async guardStaleVersion(
    tx: Prisma.TransactionClient,
    trackerId: string,
    recordId: string,
    version: number,
  ) {
    const record = await tx.trackerRecord.findFirst({
      where: { id: recordId, trackerId, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Record not found');
    if (record.version !== version) {
      throw new ConflictException('Record was modified by another session');
    }
  }

  /** Computes the target rank inside the ordering group, holding its advisory lock. */
  private async movePosition(
    tx: Prisma.TransactionClient,
    trackerId: string,
    recordId: string,
    beforeId: string | null | undefined,
    afterId: string | null | undefined,
  ): Promise<string> {
    await this.db.acquireTransactionLock(tx, `tracker-records:${trackerId}`);
    const siblings = await tx.trackerRecord.findMany({
      where: { trackerId, deletedAt: null, id: { not: recordId } },
      select: { id: true, position: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rankForMove(siblings, beforeId, afterId, (ranks) => this.rebalance(tx, ranks));
  }

  /** The live-record scope shared by the list endpoint and the CSV export. */
  private recordWhere(
    trackerId: string,
    search: string | undefined,
    typedFilters: Prisma.TrackerRecordWhereInput[],
  ): Prisma.TrackerRecordWhereInput {
    return {
      trackerId,
      deletedAt: null,
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      ...(typedFilters.length ? { AND: typedFilters } : {}),
    };
  }

  private async resolveFilters(trackerId: string, filters: TrackerRecordFilter[]) {
    if (!filters.length) return [];
    const filterFields = await this.prisma.trackerField.findMany({
      where: {
        id: { in: [...new Set(filters.map((filter) => filter.fieldId))] },
        trackerId,
        deletedAt: null,
      },
      include: { options: { where: { archivedAt: null } } },
    });
    if (filterFields.length !== new Set(filters.map((filter) => filter.fieldId)).size) {
      throw new BadRequestException('A filter field does not belong to this tracker');
    }
    return filters.flatMap((filter): Prisma.TrackerRecordWhereInput[] => {
      const field = filterFields.find((candidate) => candidate.id === filter.fieldId)!;
      return buildTrackerRecordFilter(field as FilterableField, filter);
    });
  }
}

function valueTarget(
  recordId: string,
  field: { id: string; required: boolean; type: string; options: Array<{ id: string }> },
) {
  return {
    recordId,
    fieldId: field.id,
    required: field.required,
    type: field.type,
    activeOptionIds: field.options.map((option) => option.id),
  };
}
