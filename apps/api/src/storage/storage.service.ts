import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { StorageKind } from '@prisma/client';
import type { StorageKind as ContractStorageKind } from '@coda/contracts';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';

const kindMap: Record<ContractStorageKind, StorageKind> = {
  source_document: 'SOURCE_DOCUMENT',
  file: 'FILE',
  image: 'IMAGE',
  video: 'VIDEO',
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  private pdfInspectionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {
    const config = env();
    const common = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...common, endpoint: config.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...common, endpoint: config.S3_PUBLIC_ENDPOINT });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: env().S3_BUCKET }));
    } catch {
      await this.internal.send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }));
    }
  }

  async ready(): Promise<void> {
    await this.internal.send(new HeadBucketCommand({ Bucket: env().S3_BUCKET }));
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
    if (
      input.kind === 'source_document' &&
      (await this.prisma.sourceDocument.count({
        where: { projectId: input.projectId, deletedAt: null },
      })) > 0
    ) {
      throw new ConflictException('This project already has a source PDF');
    }
    const limit = input.kind === 'source_document' ? env().PDF_MAX_BYTES : env().ASSET_MAX_BYTES;
    if (input.sizeBytes > limit)
      throw new BadRequestException(`Upload exceeds the ${limit}-byte limit`);
    const object = await this.prisma.storageObject.create({
      data: {
        projectId: input.projectId,
        kind: kindMap[input.kind],
        objectKey: `${input.projectId}/${randomUUID()}`,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
      },
    });
    const uploadUrl = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: object.objectKey,
        ContentType: object.mimeType,
        ContentLength: input.sizeBytes,
        IfNoneMatch: '*',
      }),
      { expiresIn: env().SIGNED_UPLOAD_TTL_SECONDS },
    );
    return { ...this.serialize(object), uploadUrl, expiresIn: env().SIGNED_UPLOAD_TTL_SECONDS };
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
    const head = await this.internal.send(
      new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: object.objectKey }),
    );
    if (
      head.ContentLength === undefined ||
      BigInt(head.ContentLength) !== object.sizeBytes ||
      head.ContentType !== object.mimeType
    ) {
      await this.prisma.storageObject.update({
        where: { id: object.id },
        data: { status: 'FAILED', version: { increment: 1 } },
      });
      throw new BadRequestException('Uploaded object metadata does not match the upload request');
    }
    if (object.kind === 'SOURCE_DOCUMENT') {
      const response = await this.internal.send(
        new GetObjectCommand({
          Bucket: env().S3_BUCKET,
          Key: object.objectKey,
          Range: 'bytes=0-4',
        }),
      );
      const signature = response.Body
        ? Buffer.from(await response.Body.transformToByteArray()).toString('ascii')
        : '';
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
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: object.objectKey,
        ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.originalFilename)}`,
        ResponseContentType: inline ? 'application/pdf' : 'application/octet-stream',
      }),
      { expiresIn: env().SIGNED_READ_TTL_SECONDS },
    );
    return { url, expiresIn: env().SIGNED_READ_TTL_SECONDS };
  }

  async pdfPageCount(objectKey: string, sizeBytes: number): Promise<number> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > env().PDF_MAX_BYTES) {
      throw new BadRequestException('Source document size is invalid');
    }
    return this.withExclusivePdfInspection(async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 120_000);
      try {
        const response = await this.internal.send(
          new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: objectKey }),
          { abortSignal: abort.signal },
        );
        if (!response.Body) throw new Error('PDF body is empty');
        const bytes = await response.Body.transformToByteArray();
        if (bytes.byteLength !== sizeBytes) throw new Error('PDF size changed after upload');
        return await this.inspectPdfInWorker(bytes);
      } catch {
        throw new BadRequestException('Source document is not a readable, unencrypted PDF');
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async withExclusivePdfInspection<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pdfInspectionTail;
    let release!: () => void;
    this.pdfInspectionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private inspectPdfInWorker(bytes: Uint8Array): Promise<number> {
    return new Promise((resolve, reject) => {
      const transferable = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const worker = new Worker(join(__dirname, 'pdf-page-count.worker.js'), {
        workerData: transferable,
        transferList: [transferable],
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
        reject(error);
      });
    });
  }

  async deletePhysical(objectKey: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: objectKey }));
  }

  serialize<T extends { sizeBytes: bigint }>(
    object: T,
  ): Omit<T, 'sizeBytes'> & { sizeBytes: number } {
    return { ...object, sizeBytes: Number(object.sizeBytes) };
  }
}
