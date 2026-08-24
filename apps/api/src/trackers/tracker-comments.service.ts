import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTrackerComment,
  ListTrackerCommentsQuery,
  UpdateTrackerComment,
} from '@coda/contracts';
import { decodeCursor, encodeCursor } from '../common/cursor-codec';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerActivityService } from './tracker-activity.service';
import { TrackerPermissionService } from './tracker-permission.service';

/**
 * Flat comments on one tracker record, mirroring the breakdown item-comment semantics
 * (`CollaborationService`): reads need `read_tracker`, writing needs the comment gate
 * (`TrackerPermissionService.assertCommenter`), edits and deletions stay author-only with an
 * optimistic `version` guard, and deletion is a soft `deletedAt` stamp — there is no comment
 * trash surface. A trashed or missing record rejects new comments with `404`; listing does not
 * re-check the record's state, exactly like the breakdown list.
 */
@Injectable()
export class TrackerCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly activity: TrackerActivityService,
  ) {}

  async list(userId: string, trackerId: string, recordId: string, query: ListTrackerCommentsQuery) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const cursor = query.cursor ? decodeCursor(query.cursor).id : undefined;
    const rows = await this.prisma.trackerComment.findMany({
      where: { recordId, deletedAt: null, record: { trackerId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: await this.withAuthors(data),
      nextCursor: hasMore ? encodeCursor(data.at(-1)!.id) : null,
    };
  }

  async create(userId: string, trackerId: string, recordId: string, input: CreateTrackerComment) {
    await this.permissions.assertCommenter(userId, trackerId);
    const record = await this.prisma.trackerRecord.findFirst({
      where: { id: recordId, trackerId, deletedAt: null },
      select: { id: true },
    });
    if (!record) throw new NotFoundException('Record not found');
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trackerComment.create({
        data: { recordId, authorId: userId, body: input.body },
      });
      await this.activity.commentAdded(trackerId, userId, created.id, tx);
      return created;
    });
    return this.withAuthors([comment]).then(([row]) => row!);
  }

  async update(
    userId: string,
    trackerId: string,
    recordId: string,
    commentId: string,
    input: UpdateTrackerComment,
  ) {
    await this.permissions.assertCommenter(userId, trackerId);
    const comment = await this.liveComment(trackerId, recordId, commentId);
    if (comment.authorId !== userId) {
      throw new ForbiddenException('Only the author may edit this comment');
    }
    const result = await this.prisma.trackerComment.updateMany({
      where: { id: commentId, version: input.version },
      data: { body: input.body, editedAt: new Date(), version: { increment: 1 } },
    });
    if (!result.count) throw new ConflictException('Comment has changed');
    const updated = await this.prisma.trackerComment.findUniqueOrThrow({
      where: { id: commentId },
    });
    return this.withAuthors([updated]).then(([row]) => row!);
  }

  async remove(userId: string, trackerId: string, recordId: string, commentId: string) {
    await this.permissions.assertCommenter(userId, trackerId);
    const comment = await this.liveComment(trackerId, recordId, commentId);
    if (comment.authorId !== userId) {
      throw new ForbiddenException('Only the author may delete this comment');
    }
    const deletedAt = new Date();
    await this.prisma.trackerComment.update({
      where: { id: commentId },
      data: { deletedAt },
    });
    return { id: commentId, deletedAt };
  }

  /**
   * Resolves a live comment through its owning record, so a comment is only ever reachable under
   * the tracker/record pair the route names; a missing row answers `404` like every other
   * cross-aggregate lookup on this surface.
   */
  private async liveComment(trackerId: string, recordId: string, commentId: string) {
    const comment = await this.prisma.trackerComment.findFirst({
      where: { id: commentId, deletedAt: null, record: { id: recordId, trackerId } },
      select: { id: true, authorId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  /**
   * Attaches each author's display name in one batched lookup. The tracker tables keep
   * `author_id` FK-free (appended-table convention), so unlike the breakdown comments there is no
   * relation to include; the payload still mirrors them with an embedded `author` object. A name
   * that has since vanished (purged account) degrades to a placeholder instead of dropping the row.
   */
  private async withAuthors<T extends { authorId: string }>(rows: T[]) {
    if (!rows.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.authorId))] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    return rows.map((row) => ({
      ...row,
      author: { id: row.authorId, displayName: names.get(row.authorId) ?? 'Unknown member' },
    }));
  }
}
