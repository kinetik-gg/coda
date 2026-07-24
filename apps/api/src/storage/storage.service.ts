import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { StorageKind } from '@prisma/client';
import type { StorageKind as ContractStorageKind } from '@coda/contracts';
import { env } from '../config/env';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { lockProjectLifecycle } from '../projects/project-lifecycle-lock';
import { PermissionService } from '../projects/permission.service';
import { collectStream } from './blob/collect-stream';
import { BlobStoreProvider } from './blob/blob-store-provider';

const kindMap: Record<ContractStorageKind, StorageKind> = {
  source_document: 'SOURCE_DOCUMENT',
  file: 'FILE',
  image: 'IMAGE',
  video: 'VIDEO',
};

const PDF_WORKER_MAX_YOUNG_GENERATION_MB = 32;
const PDF_WORKER_STACK_MB = 4;
const PDF_INSPECTION_CAPACITY = 4;

@Injectable()
export class StorageService implements OnModuleInit {
  private pdfInspectionTail: Promise<void> = Promise.resolve();
  private pdfInspectionOutstanding = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly blobs: BlobStoreProvider,
    private readonly db: DatabaseCapabilities,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** Prepares the active backend for use. Safe to call after a hot-swap. */
  async ensureBucket(): Promise<void> {
    await this.blobs.active().init();
  }

  async ready(): Promise<void> {
    await this.blobs.active().healthcheck();
  }

  async createUpload(
    userId: string,
    input: {
      projectId: string;
      kind: ContractStorageKind;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    await this.permissions.assert(
      userId,
      input.projectId,
      input.kind === 'source_document' ? 'manage_source_documents' : 'manage_storage_objects',
    );
    if (input.kind === 'source_document' && input.mimeType !== 'application/pdf')
      throw new BadRequestException('Source documents must be PDFs');
    const limit = input.kind === 'source_document' ? env().PDF_MAX_BYTES : env().ASSET_MAX_BYTES;
    if (input.sizeBytes > limit)
      throw new BadRequestException(`Upload exceeds the ${limit}-byte limit`);
    const { object, uploadUrl } = await this.reserveUpload(input);
    return {
      ...this.serialize(object),
      uploadUrl,
      expiresIn: env().SIGNED_UPLOAD_TTL_SECONDS,
      directUpload: this.blobs.capabilities.directUpload,
    };
  }

  async completeUpload(
    userId: string,
    projectId: string,
    storageObjectId: string,
    version: number,
  ) {
    const object = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, projectId, deletedAt: null },
    });
    if (!object) throw new NotFoundException('Storage object not found');
    await this.permissions.assert(
      userId,
      projectId,
      object.kind === 'SOURCE_DOCUMENT' ? 'manage_source_documents' : 'manage_storage_objects',
    );
    if (object.version !== version) throw new BadRequestException('Storage object has changed');
    const store = this.blobs.active();
    const stat = await store.stat(object.objectKey);
    if (
      stat.size === undefined ||
      BigInt(stat.size) !== object.sizeBytes ||
      stat.contentType !== object.mimeType
    ) {
      await this.prisma.storageObject.update({
        where: { id: object.id },
        data: { status: 'FAILED', version: { increment: 1 } },
      });
      throw new BadRequestException('Uploaded object metadata does not match the upload request');
    }
    if (object.kind === 'SOURCE_DOCUMENT') {
      const { stream } = await store.get(object.objectKey, { range: { start: 0, end: 4 } });
      const signature = (await collectStream(stream)).toString('ascii');
      if (signature !== '%PDF-') {
        await this.prisma.storageObject.update({
          where: { id: object.id },
          data: { status: 'FAILED', version: { increment: 1 } },
        });
        throw new BadRequestException('Source document does not have a valid PDF signature');
      }
    }
    const updated = await this.prisma.storageObject.update({
      where: { id: object.id },
      data: { status: 'READY', version: { increment: 1 } },
    });
    return this.serialize(updated);
  }

  async readUrl(userId: string, projectId: string, storageObjectId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const object = await this.prisma.storageObject.findFirst({
      where: { id: storageObjectId, projectId, status: 'READY', deletedAt: null },
    });
    if (!object) throw new NotFoundException('Storage object not found');
    const inline = object.kind === 'SOURCE_DOCUMENT';
    const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.originalFilename)}`;
    const contentType = inline ? 'application/pdf' : 'application/octet-stream';
    return this.blobs.active().createReadUrl(object.objectKey, { disposition, contentType });
  }

  async pdfPageCount(objectKey: string, sizeBytes: number): Promise<number> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > env().PDF_MAX_BYTES) {
      throw new BadRequestException('Source document size is invalid');
    }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    try {
      const { stream } = await this.blobs.active().get(objectKey, { abortSignal: abort.signal });
      const bytes = await collectStream(stream);
      if (bytes.byteLength !== sizeBytes) throw new Error('PDF size changed after upload');
      return await this.inspectPdfInWorker(bytes);
    } catch {
      throw new BadRequestException('Source document is not a readable, unencrypted PDF');
    } finally {
      clearTimeout(timeout);
    }
  }

  async withPdfInspectionSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pdfInspectionOutstanding >= PDF_INSPECTION_CAPACITY) {
      throw new ServiceUnavailableException('PDF inspection capacity is full; retry later');
    }
    this.pdfInspectionOutstanding += 1;
    const previous = this.pdfInspectionTail;
    let release!: () => void;
    this.pdfInspectionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      this.pdfInspectionOutstanding -= 1;
      release();
    }
  }

  private inspectPdfInWorker(bytes: Uint8Array): Promise<number> {
    return new Promise((resolve, reject) => {
      const transferable =
        bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength &&
        bytes.buffer instanceof ArrayBuffer
          ? bytes.buffer
          : // A pooled/offset buffer (e.g. a small Buffer.concat result) must be
            // copied into its own exact ArrayBuffer before transfer; Buffer.slice
            // returns a view over the shared pool, so copy explicitly.
            new Uint8Array(bytes).buffer;
      const worker = new Worker(join(__dirname, 'pdf-page-count.worker.js'), {
        workerData: transferable,
        transferList: [transferable],
        resourceLimits: {
          maxOldGenerationSizeMb: env().PDF_WORKER_MAX_OLD_GENERATION_MB,
          maxYoungGenerationSizeMb: PDF_WORKER_MAX_YOUNG_GENERATION_MB,
          stackSizeMb: PDF_WORKER_STACK_MB,
        },
      });
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new Error('PDF inspection timed out'));
      }, 120_000);
      worker.once('message', (message: { pageCount?: number; error?: string }) => {
        clearTimeout(timeout);
        void worker.terminate();
        if (message.error || !message.pageCount) {
          reject(new Error(message.error ?? 'PDF has no pages'));
          return;
        }
        resolve(message.pageCount);
      });
      worker.once('error', (error) => {
        clearTimeout(timeout);
        void worker.terminate();
        reject(error);
      });
    });
  }

  private reserveUpload(input: {
    projectId: string;
    kind: ContractStorageKind;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectLifecycle(this.db, tx, input.projectId);
      const project = await tx.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found');
      await this.db.acquireTransactionLock(tx, 'storage-upload-reservations');
      if (
        input.kind === 'source_document' &&
        (await tx.storageObject.count({
          where: {
            projectId: input.projectId,
            kind: 'SOURCE_DOCUMENT',
            status: { in: ['PENDING', 'READY'] },
            deletedAt: null,
          },
        })) > 0
      ) {
        throw new ConflictException('This project already has a source PDF');
      }
      const [projectPending, instancePending] = await Promise.all([
        tx.storageObject.aggregate({
          where: {
            projectId: input.projectId,
            status: { in: ['PENDING', 'FAILED'] },
          },
          _count: { id: true },
          _sum: { sizeBytes: true },
        }),
        tx.storageObject.aggregate({
          where: { status: { in: ['PENDING', 'FAILED'] } },
          _count: { id: true },
          _sum: { sizeBytes: true },
        }),
      ]);
      const requestedBytes = BigInt(input.sizeBytes);
      if (
        projectPending._count.id >= env().STORAGE_PENDING_MAX_OBJECTS ||
        (projectPending._sum.sizeBytes ?? 0n) + requestedBytes >
          BigInt(env().STORAGE_PENDING_MAX_BYTES) ||
        instancePending._count.id >= env().STORAGE_PENDING_INSTANCE_MAX_OBJECTS ||
        (instancePending._sum.sizeBytes ?? 0n) + requestedBytes >
          BigInt(env().STORAGE_PENDING_INSTANCE_MAX_BYTES)
      ) {
        throw new ConflictException('Incomplete upload capacity is exhausted');
      }
      const object = await tx.storageObject.create({
        data: {
          projectId: input.projectId,
          kind: kindMap[input.kind],
          objectKey: `${input.projectId}/${randomUUID()}`,
          originalFilename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
        },
      });
      const { url: uploadUrl } = await this.blobs.active().createUpload(object.objectKey, {
        contentType: object.mimeType,
        contentLength: input.sizeBytes,
      });
      return { object, uploadUrl };
    });
  }

  async deletePhysical(objectKey: string): Promise<void> {
    await this.blobs.active().delete(objectKey);
  }

  serialize<T extends { sizeBytes: bigint }>(
    object: T,
  ): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
    return { ...object, sizeBytes: Number(object.sizeBytes) };
  }
}
