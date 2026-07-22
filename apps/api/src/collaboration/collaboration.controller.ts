import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createCommentSchema, updateCommentSchema } from '@coda/contracts';
import { CollaborationService } from './collaboration.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('api/v1/projects/:projectId')
export class CollaborationController {
  constructor(
    private readonly collaboration: CollaborationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get('items/:itemId/comments')
  async comments(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
  ) {
    return { data: await this.collaboration.listComments(request.user!.id, projectId, itemId) };
  }

  @Post('items/:itemId/comments')
  async comment(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    const input = createCommentSchema.parse(body);
    const comment = await this.collaboration.comment(
      request.user!.id,
      projectId,
      itemId,
      input.body,
    );
    await this.realtime.invalidateProject(projectId, 'comments', [comment.id]);
    return {
      data: comment,
    };
  }

  @Patch('comments/:commentId')
  async update(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const input = updateCommentSchema.parse(body);
    const comment = await this.collaboration.updateComment(
      request.user!.id,
      projectId,
      commentId,
      input.body,
      input.version,
    );
    await this.realtime.invalidateProject(projectId, 'comments', [commentId]);
    return {
      data: comment,
    };
  }

  @Get('activity')
  async activity(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
  ) {
    return { data: await this.collaboration.activity(request.user!.id, projectId, cursor) };
  }
}
