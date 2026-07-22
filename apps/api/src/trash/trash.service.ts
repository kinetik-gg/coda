import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { lockProjectLifecycle } from '../projects/project-lifecycle-lock';
import { StorageService } from '../storage/storage.service';
import { StorageDeletionService } from '../storage/storage-deletion.service';
import { listTrash } from './trash-list';
import {
  PROJECT_RETENTION_MS,
  deleteQueuedStorage,
  projectPurgeAfter,
  purgeExpiredProjects,
  purgeProjectData,
  queueStorageDeletions,
  serializeProjectTrash,
} from './trash-project-purger';
import { descendantIds, descendantLevels } from './trash-tree';
import {
  purgeSourceDocument,
  restoreSourceDocument,
  trashSourceDocument,
} from './trash-source-document';

@Injectable()
export class TrashService {
  static readonly PROJECT_RETENTION_MS = PROJECT_RETENTION_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly storage: StorageService,
    private readonly storageDeletions: StorageDeletionService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    return listTrash(this.prisma, this.storage, projectId);
  }

  async trashProject(userId: string, projectId: string) {
    const membership = await this.permissions.assert(userId, projectId, 'delete_project');
    if (membership.project.ownerUserId !== userId)
      throw new ForbiddenException('Only the project owner may trash a project');
    const batch = randomUUID();
    const deletedAt = new Date();
    const project = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id: projectId },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId: batch,
          version: { increment: 1 },
          revision: { increment: 1 },
        },
      });
      await Promise.all([
        tx.projectInvitation.updateMany({
          where: { projectId, status: 'PENDING', revokedAt: null },
          data: { status: 'REVOKED', revokedAt: deletedAt },
        }),
        tx.instanceInvitation.updateMany({
          where: { projectId, status: 'PENDING', revokedAt: null },
          data: { status: 'REVOKED', revokedAt: deletedAt },
        }),
      ]);
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'project',
          resourceId: projectId,
          metadata: { batchId: batch, purgeAfter: projectPurgeAfter(deletedAt) },
        },
      });
      return updated;
    });
    return serializeProjectTrash(project);
  }

  async restoreProject(userId: string, projectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectLifecycle(tx, projectId);
      const project = await tx.project.findFirst({
        where: { id: projectId, ownerUserId: userId, deletedAt: { not: null } },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Trashed project not found');
      const restored = await tx.project.update({
        where: { id: projectId },
        data: {
          deletedAt: null,
          deletedById: null,
          deletionBatchId: null,
          version: { increment: 1 },
          revision: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'RESTORED',
          resourceType: 'project',
          resourceId: projectId,
        },
      });
      return serializeProjectTrash(restored);
    });
  }

  async trashItem(userId: string, projectId: string, itemId: string) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    const batch = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const root = await tx.breakdownItem.findFirst({
        where: { id: itemId, projectId, deletedAt: null },
        select: { id: true, title: true },
      });
      if (!root) throw new NotFoundException('Item not found');
      const descendants = await descendantIds(tx, projectId, [itemId], true);
      const itemIds = [itemId, ...descendants];
      const deletedAt = new Date();
      const result = await tx.breakdownItem.updateMany({
        where: { id: { in: itemIds }, projectId, deletedAt: null },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId: batch,
          version: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'breakdown_item',
          resourceId: itemId,
          metadata: { batchId: batch, title: root.title, count: result.count },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      return { batchId: batch, count: result.count, rootItemId: itemId };
    });
  }

  async restoreBatch(userId: string, projectId: string, batchId: string) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    return this.prisma.$transaction(async (tx) => {
      const batchItems = await tx.breakdownItem.findMany({
        where: { projectId, deletionBatchId: batchId, deletedAt: { not: null } },
        select: { id: true, parentId: true, title: true },
      });
      if (!batchItems.length) throw new NotFoundException('Deletion batch not found');
      const batchIds = new Set(batchItems.map((item) => item.id));
      const root = batchItems.find((item) => !item.parentId || !batchIds.has(item.parentId));
      if (root?.parentId) {
        const activeParent = await tx.breakdownItem.findFirst({
          where: { id: root.parentId, projectId, deletedAt: null },
          select: { id: true },
        });
        if (!activeParent) {
          throw new ConflictException('Restore the parent deletion batch first');
        }
      }
      const result = await tx.breakdownItem.updateMany({
        where: { projectId, deletionBatchId: batchId, deletedAt: { not: null } },
        data: {
          deletedAt: null,
          deletedById: null,
          deletionBatchId: null,
          version: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'RESTORED',
          resourceType: 'breakdown_item',
          resourceId: root?.id,
          metadata: { batchId, count: result.count, title: root?.title },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      return { restored: result.count, rootItemId: root?.id ?? null };
    });
  }

  async purgeProject(userId: string, projectId: string) {
    const purged = await purgeProjectData(this.prisma, this.storageDeletions, projectId, {
      ownerUserId: userId,
    });
    if (!purged) throw new ForbiddenException('Only the owner may purge a trashed project');
    return { purged: true };
  }

  async purgeItem(userId: string, projectId: string, itemId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project?.ownerUserId !== userId)
      throw new ForbiddenException('Only the project owner may purge items');
    const item = await this.prisma.breakdownItem.findFirst({
      where: { id: itemId, projectId, deletedAt: { not: null } },
    });
    if (!item) throw new NotFoundException('Trashed item not found');
    return this.prisma.$transaction(async (tx) => {
      const levels = await descendantLevels(tx, projectId, [itemId]);
      const descendantIds = levels.flat();
      const activeDescendant = descendantIds.length
        ? await tx.breakdownItem.findFirst({
            where: { id: { in: descendantIds }, projectId, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (activeDescendant) {
        throw new ConflictException('Restore or trash active descendants before purging');
      }
      for (const level of [...levels].reverse()) {
        if (level.length) await tx.breakdownItem.deleteMany({ where: { id: { in: level } } });
      }
      await tx.breakdownItem.delete({ where: { id: itemId } });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'PURGED',
          resourceType: 'breakdown_item',
          resourceId: itemId,
          metadata: { title: item.title, count: descendantIds.length + 1 },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      return { purged: true, count: descendantIds.length + 1 };
    });
  }

  async trashField(userId: string, projectId: string, fieldId: string, input: { version: number }) {
    await this.permissions.assert(userId, projectId, 'manage_fields');
    const field = await this.prisma.fieldDefinition.findFirst({
      where: { id: fieldId, projectId, deletedAt: null },
    });
    if (!field) throw new NotFoundException('Field not found');
    const deletedAt = new Date();
    const batchId = randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.fieldDefinition.updateMany({
        where: {
          id: field.id,
          projectId,
          deletedAt: null,
          version: input.version,
        },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId: batchId,
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException('Field has changed; refresh and retry');
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'field_definition',
          resourceId: field.id,
          metadata: { batchId, name: field.name },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return tx.fieldDefinition.findUniqueOrThrow({ where: { id: field.id } });
    });
    return { ...updated, batchId };
  }

  async restoreField(userId: string, projectId: string, fieldId: string) {
    await this.permissions.assert(userId, projectId, 'manage_fields');
    const field = await this.prisma.fieldDefinition.findFirst({
      where: { id: fieldId, projectId, deletedAt: { not: null } },
    });
    if (!field) throw new NotFoundException('Trashed field not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fieldDefinition.updateMany({
        where: {
          id: field.id,
          projectId,
          deletedAt: { not: null },
          version: field.version,
        },
        data: {
          deletedAt: null,
          deletedById: null,
          deletionBatchId: null,
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictException('Field has changed; refresh and retry');
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'RESTORED',
          resourceType: 'field_definition',
          resourceId: field.id,
          metadata: { name: field.name },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return tx.fieldDefinition.findUniqueOrThrow({ where: { id: field.id } });
    });
  }

  async purgeField(userId: string, projectId: string, fieldId: string) {
    await this.assertOwner(userId, projectId);
    const field = await this.prisma.fieldDefinition.findFirst({
      where: { id: fieldId, projectId, deletedAt: { not: null } },
    });
    if (!field) throw new NotFoundException('Trashed field not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.fieldDefinition.delete({ where: { id: field.id } });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'PURGED',
          resourceType: 'field_definition',
          resourceId: field.id,
          metadata: { name: field.name },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    });
    return { purged: true };
  }

  async trashSourceDocument(userId: string, projectId: string, documentId: string) {
    await this.assertOwner(userId, projectId);
    return trashSourceDocument(this.prisma, userId, projectId, documentId);
  }

  async restoreSourceDocument(userId: string, projectId: string, documentId: string) {
    await this.permissions.assert(userId, projectId, 'manage_source_documents');
    return restoreSourceDocument(this.prisma, userId, projectId, documentId);
  }

  async purgeSourceDocument(userId: string, projectId: string, documentId: string) {
    await this.assertOwner(userId, projectId);
    return purgeSourceDocument(this.prisma, this.storageDeletions, userId, projectId, documentId);
  }

  async trashStorageObject(userId: string, projectId: string, storageObjectId: string) {
    const object = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, projectId, deletedAt: null },
      include: { sourceDocument: true },
    });
    if (!object) throw new NotFoundException('Storage object not found');
    await this.permissions.assert(
      userId,
      projectId,
      object.kind === 'SOURCE_DOCUMENT' ? 'manage_source_documents' : 'manage_storage_objects',
    );
    if (object.sourceDocument) {
      throw new ConflictException('Trash the linked source document instead');
    }
    const deletedAt = new Date();
    const batchId = randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.storageObject.update({
        where: { id: object.id },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId: batchId,
          version: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'storage_object',
          resourceId: object.id,
          metadata: { batchId, filename: object.originalFilename },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return result;
    });
    return { ...this.storage.serialize(updated), batchId };
  }

  async restoreStorageObject(userId: string, projectId: string, storageObjectId: string) {
    const object = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, projectId, deletedAt: { not: null } },
      include: { sourceDocument: true },
    });
    if (!object) throw new NotFoundException('Trashed storage object not found');
    await this.permissions.assert(
      userId,
      projectId,
      object.kind === 'SOURCE_DOCUMENT' ? 'manage_source_documents' : 'manage_storage_objects',
    );
    if (object.sourceDocument?.deletedAt) {
      throw new ConflictException('Restore the linked source document instead');
    }
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.storageObject.update({
        where: { id: object.id },
        data: {
          deletedAt: null,
          deletedById: null,
          deletionBatchId: null,
          version: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'RESTORED',
          resourceType: 'storage_object',
          resourceId: object.id,
          metadata: { filename: object.originalFilename },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return this.storage.serialize(result);
    });
  }

  async purgeStorageObject(userId: string, projectId: string, storageObjectId: string) {
    await this.assertOwner(userId, projectId);
    const object = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, projectId, deletedAt: { not: null } },
      include: { _count: { select: { fieldValues: true } }, sourceDocument: true },
    });
    if (!object) throw new NotFoundException('Trashed storage object not found');
    if (object._count.fieldValues > 0 || object.sourceDocument) {
      throw new ConflictException(
        'Storage object is still referenced by a field value or source document',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await queueStorageDeletions(tx, projectId, [object.objectKey]);
      await tx.storageObject.delete({ where: { id: object.id } });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'PURGED',
          resourceType: 'storage_object',
          resourceId: object.id,
          metadata: { filename: object.originalFilename },
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    });
    deleteQueuedStorage(this.storageDeletions, [object.objectKey]);
    return { purged: true };
  }

  async listTrashedProjects(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: {
        deletedAt: { not: null },
        memberships: { some: { userId } },
      },
      select: {
        id: true,
        name: true,
        description: true,
        ownerUserId: true,
        deletedAt: true,
        deletedById: true,
        deletionBatchId: true,
        version: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return projects.map((project) => ({
      ...serializeProjectTrash(project),
      canRestore: project.ownerUserId === userId,
      canPurge: project.ownerUserId === userId,
    }));
  }

  async purgeExpiredProjects(now = new Date()): Promise<number> {
    return purgeExpiredProjects(this.prisma, this.storageDeletions, now);
  }

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.deletedAt || project.ownerUserId !== userId) {
      throw new ForbiddenException('Only the project owner may permanently purge data');
    }
    return project;
  }
}
