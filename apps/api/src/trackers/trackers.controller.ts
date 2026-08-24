import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createTrackerSchema, listTrackersQuerySchema, updateTrackerSchema } from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerTrashService } from '../trash/tracker-trash.service';
import { TrackerActivityService } from './tracker-activity.service';
import { TrackersService } from './trackers.service';

@Controller('api/v1/trackers')
export class TrackersController {
  constructor(
    private readonly trackers: TrackersService,
    private readonly trackerActivity: TrackerActivityService,
    private readonly trash: TrackerTrashService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.trackers.list(request.user!.id, listTrackersQuerySchema.parse(query)),
    };
  }

  /** The caller's trashed trackers ("trackers I own that are trashed"), newest deletion first. */
  @Get('trash')
  async listTrash(@Req() request: Request) {
    return { data: await this.trash.listTrashed(request.user!.id) };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const tracker = await this.trackers.create(request.user!.id, createTrackerSchema.parse(body));
    await this.realtime.invalidateTracker(tracker.id, 'tracker', [tracker.id]);
    return { data: tracker };
  }

  @Get(':trackerId')
  async get(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.trackers.get(request.user!.id, trackerId) };
  }

  /**
   * The tracker activity feed, paginated like the project activity route: up to 100 newest
   * events, with the last event id as the next page's `cursor` when the page is full.
   */
  @Get(':trackerId/activity')
  async activity(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Query('cursor') cursor?: string,
  ) {
    return { data: await this.trackerActivity.activity(request.user!.id, trackerId, cursor) };
  }

  @Patch(':trackerId')
  async update(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const tracker = await this.trackers.update(
      request.user!.id,
      trackerId,
      updateTrackerSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'tracker', [trackerId]);
    return { data: tracker };
  }

  @Delete(':trackerId')
  async remove(@Req() request: Request, @Param('trackerId') trackerId: string) {
    const result = await this.trash.trash(request.user!.id, trackerId);
    await this.realtime.invalidateTracker(trackerId, 'tracker', [trackerId]);
    return { data: result };
  }

  @Post(':trackerId/restore')
  async restore(@Req() request: Request, @Param('trackerId') trackerId: string) {
    const tracker = await this.trash.restore(request.user!.id, trackerId);
    await this.realtime.invalidateTracker(trackerId, 'tracker', [trackerId]);
    return { data: tracker };
  }

  @Delete(':trackerId/purge')
  async purge(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.trash.purge(request.user!.id, trackerId) };
  }
}
