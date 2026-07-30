import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateScreenplayCommentThread,
  ListScreenplayCommentThreadsQuery,
  ScreenplayCommentAuthor,
  ScreenplayCommentThreadStatus,
  ScreenplayCommentThreadView,
  ScreenplayCommentView,
} from '@coda/contracts';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreenplayPermissionService } from '../screenplay-permission.service';

type ThreadRow = Prisma.ScreenplayCommentThreadGetPayload<{
  include: { comments: { orderBy: { createdAt: 'asc' } } };
}>;
type CommentRow = ThreadRow['comments'][number];

@Injectable()
export class ScreenplayCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
  ) {}

  async list(
    userId: string,
    screenplayId: string,
    query: ListScreenplayCommentThreadsQuery,
  ): Promise<ScreenplayCommentThreadView[]> {
    await this.assertActiveRead(userId, screenplayId);
    const threads = await this.prisma.screenplayCommentThread.findMany({
      where: {
        screenplayId,
        ...(query.status === 'all'
          ? {}
          : { status: query.status === 'open' ? 'OPEN' : 'RESOLVED' }),
      },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return this.hydrateThreads(threads);
  }

  async createThread(
    userId: string,
    screenplayId: string,
    input: CreateScreenplayCommentThread,
  ): Promise<ScreenplayCommentThreadView> {
    await this.assertActiveRead(userId, screenplayId);
    const thread = await this.prisma.screenplayCommentThread.create({
      data: {
        screenplayId,
        authorUserId: userId,
        anchorStart: Buffer.from(input.anchorStart, 'base64'),
        anchorEnd: Buffer.from(input.anchorEnd, 'base64'),
        quotedText: input.quotedText,
        comments: { create: { authorUserId: userId, body: input.body } },
      },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    return this.hydrateThread(thread);
  }

  async reply(
    userId: string,
    screenplayId: string,
    threadId: string,
    body: string,
  ): Promise<ScreenplayCommentView> {
    await this.assertActiveRead(userId, screenplayId);
    const thread = await this.thread(screenplayId, threadId);
    if (thread.status === 'RESOLVED') {
      throw new ForbiddenException('Resolved threads cannot receive replies');
    }
    const comment = await this.prisma.screenplayComment.create({
      data: { threadId, authorUserId: userId, body },
    });
    return this.hydrateComment(comment);
  }

  async updateComment(
    userId: string,
    screenplayId: string,
    commentId: string,
    body: string,
  ): Promise<ScreenplayCommentView> {
    await this.assertActiveRead(userId, screenplayId);
    const comment = await this.comment(screenplayId, commentId);
    if (comment.authorUserId !== userId) {
      throw new ForbiddenException('Only the author may edit this comment');
    }
    const updated = await this.prisma.screenplayComment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
    });
    return this.hydrateComment(updated);
  }

  async deleteComment(
    userId: string,
    screenplayId: string,
    commentId: string,
  ): Promise<ScreenplayCommentView> {
    await this.assertActiveRead(userId, screenplayId);
    const comment = await this.comment(screenplayId, commentId);
    if (comment.authorUserId !== userId) {
      await this.permissions.assert(userId, screenplayId, 'manage_screenplay_settings');
    }
    const deleted = await this.prisma.screenplayComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return this.hydrateComment(deleted);
  }

  async setResolved(
    userId: string,
    screenplayId: string,
    threadId: string,
    resolved: boolean,
  ): Promise<ScreenplayCommentThreadView> {
    await this.assertActiveRead(userId, screenplayId);
    const thread = await this.thread(screenplayId, threadId);
    if (thread.authorUserId !== userId) {
      await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    }
    const updated = await this.prisma.screenplayCommentThread.update({
      where: { id: threadId },
      data: resolved
        ? {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedById: userId,
          }
        : { status: 'OPEN', resolvedAt: null, resolvedById: null },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    return this.hydrateThread(updated);
  }

  private async assertActiveRead(userId: string, screenplayId: string): Promise<void> {
    await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    // Redundant by design: `ScreenplayPermissionService.membership` has 404'd a soft-deleted
    // screenplay in both branches since #263. Kept as defence in depth for the comments surface —
    // comment threads/replies must never resolve against a trashed screenplay even if the choke
    // point were ever loosened again.
    const screenplay = await this.prisma.screenplay.findUnique({
      where: { id: screenplayId },
      select: { deletedAt: true },
    });
    if (!screenplay || screenplay.deletedAt) {
      throw new NotFoundException('Screenplay not found');
    }
  }

  private async thread(screenplayId: string, threadId: string) {
    const thread = await this.prisma.screenplayCommentThread.findFirst({
      where: { id: threadId, screenplayId },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!thread) throw new NotFoundException('Comment thread not found');
    return thread;
  }

  private async comment(screenplayId: string, commentId: string) {
    const comment = await this.prisma.screenplayComment.findFirst({
      where: { id: commentId, deletedAt: null, thread: { screenplayId } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private async hydrateThreads(threads: ThreadRow[]): Promise<ScreenplayCommentThreadView[]> {
    const authors = await this.authors(
      threads.flatMap((thread) => [
        thread.authorUserId,
        ...thread.comments.map((comment) => comment.authorUserId),
      ]),
    );
    return threads.map((thread) => this.threadView(thread, authors));
  }

  private async hydrateThread(thread: ThreadRow): Promise<ScreenplayCommentThreadView> {
    return (await this.hydrateThreads([thread]))[0]!;
  }

  private async hydrateComment(comment: CommentRow): Promise<ScreenplayCommentView> {
    const authors = await this.authors([comment.authorUserId]);
    return this.commentView(comment, authors);
  }

  private async authors(userIds: string[]): Promise<Map<string, ScreenplayCommentAuthor>> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private threadView(
    thread: ThreadRow,
    authors: ReadonlyMap<string, ScreenplayCommentAuthor>,
  ): ScreenplayCommentThreadView {
    return {
      ...thread,
      anchorStart: Buffer.from(thread.anchorStart).toString('base64'),
      anchorEnd: Buffer.from(thread.anchorEnd).toString('base64'),
      status: thread.status as ScreenplayCommentThreadStatus,
      resolvedAt: thread.resolvedAt?.toISOString() ?? null,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      author: this.author(thread.authorUserId, authors),
      comments: thread.comments.map((comment) => this.commentView(comment, authors)),
    };
  }

  private commentView(
    comment: CommentRow,
    authors: ReadonlyMap<string, ScreenplayCommentAuthor>,
  ): ScreenplayCommentView {
    return {
      ...comment,
      body: comment.deletedAt ? null : comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
      deletedAt: comment.deletedAt?.toISOString() ?? null,
      author: this.author(comment.authorUserId, authors),
    };
  }

  private author(
    userId: string,
    authors: ReadonlyMap<string, ScreenplayCommentAuthor>,
  ): ScreenplayCommentAuthor {
    return authors.get(userId) ?? { id: userId, displayName: 'Former member' };
  }
}
