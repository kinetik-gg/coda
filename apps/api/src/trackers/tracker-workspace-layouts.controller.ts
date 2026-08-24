import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  publishWorkspaceLayoutSchema,
  resetWorkspaceLayoutSchema,
  saveWorkspaceLayoutSchema,
} from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerWorkspaceLayoutsService } from './tracker-workspace-layouts.service';

@Controller('api/v1/trackers/:trackerId/workspace-layout')
export class TrackerWorkspaceLayoutsController {
  constructor(
    private readonly layouts: TrackerWorkspaceLayoutsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async get(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.layouts.get(request.user!.id, trackerId) };
  }

  @Put()
  async save(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = saveWorkspaceLayoutSchema.parse(body);
    return {
      data: await this.layouts.save(
        request.user!.id,
        trackerId,
        input.layout,
        input.expectedRevision,
      ),
    };
  }

  @Post('reset')
  async reset(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = resetWorkspaceLayoutSchema.parse(body);
    return {
      data: await this.layouts.reset(request.user!.id, trackerId, input.expectedRevision),
    };
  }

  @Post('publish')
  async publish(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = publishWorkspaceLayoutSchema.parse(body);
    const published = await this.layouts.publish(
      request.user!.id,
      trackerId,
      input.personalRevision,
      input.defaultRevision,
    );
    await this.realtime.invalidateTracker(trackerId, 'workspace-default', [trackerId]);
    return { data: published };
  }
}
