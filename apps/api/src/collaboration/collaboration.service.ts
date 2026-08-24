import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { publicActivityMetadata } from './activity-metadata';

@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async listComments(userId: string, projectId: string, itemId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    return this.prisma.comment.findMany({
      where: { projectId, itemId, deletedAt: null },
      include: { author: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async comment(userId: string, projectId: string, itemId: string, body: string) {
    await this.permissions.assert(userId, projectId, 'comment');
    const item = await this.prisma.breakdownItem.findFirst({
      where: { id: itemId, projectId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item not found');
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { projectId, itemId, authorId: userId, body },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'COMMENTED',
          resourceType: 'comment',
          resourceId: comment.id,
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return comment;
    });
  }

  async updateComment(
    userId: string,
    projectId: string,
    commentId: string,
    body: string,
    version: number,
  ) {
    await this.permissions.assert(userId, projectId, 'comment');
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, projectId, deletedAt: null },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId)
      throw new ForbiddenException('Only the author may edit this comment');
    const result = await this.prisma.comment.updateMany({
      where: { id: commentId, version },
      data: { body, version: { increment: 1 } },
    });
    if (!result.count) throw new ConflictException('Comment has changed');
    return this.prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
  }

  async activity(userId: string, projectId: string, cursor?: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const events = await this.prisma.activityEvent.findMany({
      where: { projectId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 100,
    });
    return events.map((event) => ({
      ...event,
      metadata: publicActivityMetadata(event.resourceType, event.metadata),
    }));
  }
}
