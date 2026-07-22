import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rankBetween } from '../common/rank';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { StorageService } from './storage.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly storage: StorageService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    input: { storageObjectId: string; title: string },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_source_documents');
    const object = await this.prisma.storageObject.findFirst({
      where: {
        id: input.storageObjectId,
        projectId,
        kind: 'SOURCE_DOCUMENT',
        status: 'READY',
        deletedAt: null,
      },
    });
    if (!object) throw new BadRequestException('A ready PDF storage object is required');

    const existing = await this.prisma.sourceDocument.findUnique({
      where: { storageObjectId: object.id },
      include: { storageObject: true },
    });
    if (existing) {
      if (existing.projectId !== projectId) {
        throw new BadRequestException('The storage object is already linked to another project');
      }
      return existing;
    }

    const activeDocument = await this.prisma.sourceDocument.findFirst({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    if (activeDocument) {
      throw new ConflictException('This project already has a source PDF');
    }

    try {
      const pageCount = await this.storage.pdfPageCount(object.objectKey);
      return await this.prisma.sourceDocument.create({
        data: { projectId, storageObjectId: object.id, title: input.title, pageCount },
        include: { storageObject: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This project already has a source PDF');
      }
      throw error;
    }
  }

  async addReference(
    userId: string,
    projectId: string,
    itemId: string,
    input: { sourceDocumentId: string; startPage: number; endPage: number },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_items');
    const [item, document, last] = await Promise.all([
      this.prisma.breakdownItem.findFirst({ where: { id: itemId, projectId, deletedAt: null } }),
      this.prisma.sourceDocument.findFirst({
        where: { id: input.sourceDocumentId, projectId, deletedAt: null },
      }),
      this.prisma.itemSourceReference.findFirst({
        where: { itemId },
        orderBy: { position: 'desc' },
      }),
    ]);
    if (!item || !document) throw new NotFoundException('Item or source document not found');
    if (document.pageCount && input.endPage > document.pageCount)
      throw new BadRequestException('Page range exceeds the document');
    return this.prisma.itemSourceReference.create({
      data: {
        itemId,
        sourceDocumentId: document.id,
        startPage: input.startPage,
        endPage: input.endPage,
        position: rankBetween(last?.position, null),
      },
    });
  }
}
