import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createScreenplayCommentSchema,
  createScreenplayCommentThreadSchema,
  listScreenplayCommentThreadsQuerySchema,
  resolveScreenplayCommentThreadSchema,
  updateScreenplayCommentSchema,
} from '@coda/contracts';
import { ScreenplayCommentsService } from './screenplay-comments.service';

@Controller('api/v1/screenplays/:screenplayId')
export class ScreenplayCommentsController {
  constructor(private readonly comments: ScreenplayCommentsService) {}

  @Get('comment-threads')
  async list(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Query() query: unknown,
  ) {
    return {
      data: await this.comments.list(
        request.user!.id,
        screenplayId,
        listScreenplayCommentThreadsQuerySchema.parse(query),
      ),
    };
  }

  @Post('comment-threads')
  async createThread(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.comments.createThread(
        request.user!.id,
        screenplayId,
        createScreenplayCommentThreadSchema.parse(body),
      ),
    };
  }

  @Post('comment-threads/:threadId/comments')
  async reply(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ) {
    const input = createScreenplayCommentSchema.parse(body);
    return {
      data: await this.comments.reply(request.user!.id, screenplayId, threadId, input.body),
    };
  }

  @Patch('comment-threads/:threadId/resolution')
  async resolve(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ) {
    const input = resolveScreenplayCommentThreadSchema.parse(body);
    return {
      data: await this.comments.setResolved(
        request.user!.id,
        screenplayId,
        threadId,
        input.resolved,
      ),
    };
  }

  @Patch('comments/:commentId')
  async updateComment(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ) {
    const input = updateScreenplayCommentSchema.parse(body);
    return {
      data: await this.comments.updateComment(
        request.user!.id,
        screenplayId,
        commentId,
        input.body,
      ),
    };
  }

  @Delete('comments/:commentId')
  async deleteComment(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('commentId') commentId: string,
  ) {
    return {
      data: await this.comments.deleteComment(request.user!.id, screenplayId, commentId),
    };
  }
}
