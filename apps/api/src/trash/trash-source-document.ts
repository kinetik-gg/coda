import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageDeletionService } from '../storage/storage-deletion.service';
import { deleteQueuedStorage, queueStorageDeletions } from './trash-project-purger';

export async function trashSourceDocument(
  prisma: PrismaService,
  userId: string,
  projectId: string,
  documentId: string,
) {
  const document = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId, deletedAt: null },
    include: { storageObject: true },
  });
  if (!document) throw new NotFoundException('Source document not found');
  const deletedAt = new Date();
  const batchId = randomUUID();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.sourceDocument.update({
      where: { id: document.id },
      data: {
        deletedAt,
        deletedById: userId,
        deletionBatchId: batchId,
        version: { increment: 1 },
      },
      include: { storageObject: true },
    });
    await tx.storageObject.update({
      where: { id: document.storageObjectId },
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
        resourceType: 'source_document',
        resourceId: document.id,
        metadata: { batchId, title: document.title },
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return result;
  });
  return { ...updated, batchId };
}

export async function restoreSourceDocument(
  prisma: PrismaService,
  userId: string,
  projectId: string,
  documentId: string,
) {
  const document = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId, deletedAt: { not: null } },
    include: { storageObject: true },
  });
  if (!document) throw new NotFoundException('Trashed source document not found');
  return prisma.$transaction(async (tx) => {
    await tx.storageObject.update({
      where: { id: document.storageObjectId },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
      },
    });
    const result = await tx.sourceDocument.update({
      where: { id: document.id },
      data: {
        deletedAt: null,
        deletedById: null,
        deletionBatchId: null,
        version: { increment: 1 },
      },
      include: { storageObject: true },
    });
    await tx.activityEvent.create({
      data: {
        projectId,
        actorId: userId,
        action: 'RESTORED',
        resourceType: 'source_document',
        resourceId: document.id,
        metadata: { title: document.title },
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return result;
  });
}

export async function purgeSourceDocument(
  prisma: PrismaService,
  storageDeletions: StorageDeletionService,
  userId: string,
  projectId: string,
  documentId: string,
) {
  const document = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId, deletedAt: { not: null } },
    include: { storageObject: true },
  });
  if (!document) throw new NotFoundException('Trashed source document not found');
  const deleteStorage = await prisma.$transaction(async (tx) => {
    await tx.itemSourceReference.deleteMany({ where: { sourceDocumentId: document.id } });
    await tx.sourceDocument.delete({ where: { id: document.id } });
    const remainingReferences = await tx.fieldValue.count({
      where: { storageObjectId: document.storageObjectId },
    });
    if (document.storageObject.deletedAt && remainingReferences === 0) {
      await queueStorageDeletions(tx, projectId, [document.storageObject.objectKey]);
      await tx.storageObject.delete({ where: { id: document.storageObjectId } });
    }
    await tx.activityEvent.create({
      data: {
        projectId,
        actorId: userId,
        action: 'PURGED',
        resourceType: 'source_document',
        resourceId: document.id,
        metadata: { title: document.title },
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return document.storageObject.deletedAt !== null && remainingReferences === 0;
  });
  if (deleteStorage) deleteQueuedStorage(storageDeletions, [document.storageObject.objectKey]);
  return { purged: true, storageObjectPurged: deleteStorage };
}
