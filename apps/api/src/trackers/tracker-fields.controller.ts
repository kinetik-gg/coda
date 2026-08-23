import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  archiveTrackerFieldSchema,
  createFieldOptionSchema,
  createTrackerFieldSchema,
  reorderTrackerFieldSchema,
  updateTrackerFieldOptionSchema,
  updateTrackerFieldSchema,
} from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerFieldsService } from './tracker-fields.service';

/**
 * Field-definition routes for one tracker. Every mutation invalidates the tracker's `fields`
 * resource; option mutations invalidate through the owning field.
 */
@Controller('api/v1/trackers/:trackerId/fields')
export class TrackerFieldsController {
  constructor(
    private readonly fields: TrackerFieldsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.fields.list(request.user!.id, trackerId) };
  }

  @Post()
  async create(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const field = await this.fields.create(
      request.user!.id,
      trackerId,
      createTrackerFieldSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'fields', [field.id]);
    return { data: field };
  }

  @Get(':fieldId')
  async get(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
  ) {
    return { data: await this.fields.get(request.user!.id, trackerId, fieldId) };
  }

  @Patch(':fieldId')
  async update(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const field = await this.fields.update(
      request.user!.id,
      trackerId,
      fieldId,
      updateTrackerFieldSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: field };
  }

  @Patch(':fieldId/reorder')
  async reorder(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const field = await this.fields.reorder(
      request.user!.id,
      trackerId,
      fieldId,
      reorderTrackerFieldSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: field };
  }

  @Delete(':fieldId')
  async archive(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const { version } = archiveTrackerFieldSchema.parse(body);
    const result = await this.fields.archive(request.user!.id, trackerId, fieldId, version);
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: result };
  }

  @Post(':fieldId/options')
  async createOption(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const option = await this.fields.createOption(
      request.user!.id,
      trackerId,
      fieldId,
      createFieldOptionSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: option };
  }

  @Patch(':fieldId/options/:optionId')
  async updateOption(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Param('optionId') optionId: string,
    @Body() body: unknown,
  ) {
    const option = await this.fields.updateOption(
      request.user!.id,
      trackerId,
      fieldId,
      optionId,
      updateTrackerFieldOptionSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: option };
  }

  @Delete(':fieldId/options/:optionId')
  async archiveOption(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('fieldId') fieldId: string,
    @Param('optionId') optionId: string,
  ) {
    const result = await this.fields.archiveOption(request.user!.id, trackerId, fieldId, optionId);
    await this.realtime.invalidateTracker(trackerId, 'fields', [fieldId]);
    return { data: result };
  }
}
