import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createTrackerSchema, listTrackersQuerySchema, updateTrackerSchema } from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackersService } from './trackers.service';

@Controller('api/v1/trackers')
export class TrackersController {
  constructor(
    private readonly trackers: TrackersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.trackers.list(request.user!.id, listTrackersQuerySchema.parse(query)),
    };
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
    const result = await this.trackers.remove(request.user!.id, trackerId);
    await this.realtime.invalidateTracker(trackerId, 'tracker', [trackerId]);
    return { data: result };
  }
}
