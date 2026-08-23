import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  bulkDeleteTrackerRecordsSchema,
  bulkSetTrackerRecordValuesSchema,
  createTrackerRecordSchema,
  listTrackerRecordsQuerySchema,
  reorderTrackerRecordSchema,
  setTrackerRecordFieldValueSchema,
  updateTrackerRecordSchema,
} from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerRecordsService } from './tracker-records.service';

/**
 * Record-grid routes for one tracker. Every mutation invalidates the tracker's `records`
 * resource with the affected record ids (bulk operations report the ids they actually touched).
 */
@Controller('api/v1/trackers/:trackerId/records')
export class TrackerRecordsController {
  constructor(
    private readonly records: TrackerRecordsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Query() query: unknown,
  ) {
    const result = await this.records.list(
      request.user!.id,
      trackerId,
      listTrackerRecordsQuerySchema.parse(query),
    );
    return { data: result.data, meta: { nextCursor: result.nextCursor } };
  }

  @Post()
  async create(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const record = await this.records.create(
      request.user!.id,
      trackerId,
      createTrackerRecordSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'records', [record.id]);
    return { data: record };
  }

  @Post('bulk-set')
  async bulkSetValues(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const result = await this.records.bulkSetValues(
      request.user!.id,
      trackerId,
      bulkSetTrackerRecordValuesSchema.parse(body),
    );
    await this.realtime.invalidateTracker(
      trackerId,
      'records',
      result.records.map((record) => record.id),
    );
    return { data: result };
  }

  @Post('bulk-delete')
  async bulkDelete(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const result = await this.records.bulkDelete(
      request.user!.id,
      trackerId,
      bulkDeleteTrackerRecordsSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'records', result.deletedIds);
    return { data: result };
  }

  @Get(':recordId')
  async get(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
  ) {
    return { data: await this.records.get(request.user!.id, trackerId, recordId) };
  }

  @Patch(':recordId')
  async update(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const record = await this.records.update(
      request.user!.id,
      trackerId,
      recordId,
      updateTrackerRecordSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'records', [recordId]);
    return { data: record };
  }

  @Patch(':recordId/reorder')
  async reorder(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const record = await this.records.reorder(
      request.user!.id,
      trackerId,
      recordId,
      reorderTrackerRecordSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'records', [recordId]);
    return { data: record };
  }

  @Put(':recordId/fields/:fieldId')
  async setValue(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const record = await this.records.setValue(
      request.user!.id,
      trackerId,
      recordId,
      fieldId,
      setTrackerRecordFieldValueSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'records', [recordId]);
    return { data: record };
  }
}
