import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTrackerCommentSchema,
  listTrackerCommentsQuerySchema,
  updateTrackerCommentSchema,
} from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerCommentsService } from './tracker-comments.service';

/**
 * Comment routes under one tracker record. Every mutation invalidates the tracker's `comments`
 * resource with the affected comment id; reads emit nothing.
 */
@Controller('api/v1/trackers/:trackerId/records/:recordId/comments')
export class TrackerCommentsController {
  constructor(
    private readonly comments: TrackerCommentsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Query() query: unknown,
  ) {
    const result = await this.comments.list(
      request.user!.id,
      trackerId,
      recordId,
      listTrackerCommentsQuerySchema.parse(query),
    );
    return { data: result.data, meta: { nextCursor: result.nextCursor } };
  }

  @Post()
  async create(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Body() body: unknown,
  ) {
    const comment = await this.comments.create(
      request.user!.id,
      trackerId,
      recordId,
      createTrackerCommentSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'comments', [comment.id]);
    return { data: comment };
  }

  @Patch(':commentId')
  async update(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const comment = await this.comments.update(
      request.user!.id,
      trackerId,
      recordId,
      commentId,
      updateTrackerCommentSchema.parse(body),
    );
    await this.realtime.invalidateTracker(trackerId, 'comments', [commentId]);
    return { data: comment };
  }

  @Delete(':commentId')
  async remove(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
  ) {
    const result = await this.comments.remove(
      request.user!.id,
      trackerId,
      recordId,
      commentId,
    );
    await this.realtime.invalidateTracker(trackerId, 'comments', [commentId]);
    return { data: result };
  }
}
