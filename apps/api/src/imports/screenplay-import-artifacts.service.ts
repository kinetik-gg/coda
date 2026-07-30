import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CompleteScreenplayImportArtifact,
  ReserveScreenplayImportArtifact,
} from '@coda/contracts';
import {
  screenplayConversionReportSchema,
  SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
} from '@coda/contracts';
import type { Prisma, ScreenplayImportArtifact } from '@prisma/client';
import { env } from '../config/env';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { BlobStoreProvider } from '../storage/blob/blob-store-provider';

const PENDING_STATUSES = ['PENDING', 'FAILED'] as const;

@Injectable()
export class ScreenplayImportArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
    private readonly blobs: BlobStoreProvider,
    private readonly db: DatabaseCapabilities,
  ) {}

  async reserve(userId: string, screenplayId: string, input: ReserveScreenplayImportArtifact) {
    await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    if (input.sizeBytes > env().ASSET_MAX_BYTES) {
      throw new BadRequestException(`Upload exceeds the ${env().ASSET_MAX_BYTES}-byte asset limit`);
    }
    const artifact = await this.reserveWithinCapacity(userId, screenplayId, input);
    try {
      const upload = await this.blobs.active().createUpload(artifact.objectKey, {
        contentType: artifact.mimeType,
        contentLength: input.sizeBytes,
      });
      return {
        ...this.serializeMetadata(artifact),
        uploadUrl: upload.url,
        expiresIn: upload.expiresIn,
        directUpload: this.blobs.capabilities.directUpload,
      };
    } catch (error) {
      await this.prisma.screenplayImportArtifact.deleteMany({
        where: { id: artifact.id, status: 'PENDING' },
      });
      throw error;
    }
  }

  async complete(
    userId: string,
    screenplayId: string,
    artifactId: string,
    input: CompleteScreenplayImportArtifact,
  ) {
    await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    const artifact = await this.pendingArtifact(screenplayId, artifactId);
    if (artifact.version !== input.version) {
      throw new ConflictException('Screenplay import artifact has changed');
    }
    if (input.report.sourceFormat !== artifact.sourceFormat) {
      throw new BadRequestException('Conversion report source format does not match the upload');
    }
    const stat = await this.statOrFail(artifact);
    if (
      stat.size === undefined ||
      BigInt(stat.size) !== artifact.sizeBytes ||
      stat.contentType !== artifact.mimeType
    ) {
      await this.failPending(artifact);
      throw new BadRequestException('Uploaded object metadata does not match the reservation');
    }
    const result = await this.prisma.screenplayImportArtifact.updateMany({
      where: {
        id: artifact.id,
        screenplayId,
        status: 'PENDING',
        version: input.version,
      },
      data: {
        status: 'READY',
        convertedFountain: input.convertedFountain,
        reportSchemaVersion: SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
        conversionReport: input.report as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Screenplay import artifact has changed');
    return this.get(userId, screenplayId, artifactId);
  }

  async get(userId: string, screenplayId: string, artifactId: string) {
    await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    await this.assertActiveScreenplay(screenplayId);
    const artifact = await this.prisma.screenplayImportArtifact.findFirst({
      where: { id: artifactId, screenplayId, status: 'READY' },
    });
    if (!artifact) throw new NotFoundException('Screenplay import artifact not found');
    return this.serializeReady(artifact);
  }

  async originalReadUrl(userId: string, screenplayId: string, artifactId: string) {
    await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    await this.assertActiveScreenplay(screenplayId);
    const artifact = await this.prisma.screenplayImportArtifact.findFirst({
      where: { id: artifactId, screenplayId, status: 'READY' },
    });
    if (!artifact) throw new NotFoundException('Screenplay import artifact not found');
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(
      artifact.originalFilename,
    )}`;
    return this.blobs.active().createReadUrl(artifact.objectKey, {
      disposition,
      contentType: artifact.mimeType,
    });
  }

  /**
   * The pending artifact a server-side conversion is about to run against, with
   * the caller's optimistic `version` already checked. Exposed so the conversion
   * path shares exactly this service's notion of "convertible" rather than
   * re-querying the table with its own predicate.
   */
  async pendingForConversion(screenplayId: string, artifactId: string, version: number) {
    const artifact = await this.pendingArtifact(screenplayId, artifactId);
    if (artifact.version !== version) {
      throw new ConflictException('Screenplay import artifact has changed');
    }
    return artifact;
  }

  /**
   * Marks a pending artifact `FAILED`. `FAILED` is what makes the original blob
   * reclaimable: the stale-upload sweep queues both `PENDING` and `FAILED`
   * artifacts for deletion, so a terminated conversion leaves nothing orphaned.
   */
  async failConversion(artifact: ScreenplayImportArtifact): Promise<void> {
    await this.failPending(artifact);
  }

  private reserveWithinCapacity(
    userId: string,
    screenplayId: string,
    input: ReserveScreenplayImportArtifact,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.db.acquireTransactionLock(tx, 'screenplay-import-artifact-reservations');
      const screenplay = await tx.screenplay.findFirst({
        where: { id: screenplayId, deletedAt: null },
        select: { id: true },
      });
      if (!screenplay) throw new NotFoundException('Screenplay not found');
      const [screenplayPending, artifactPending, storagePending] = await Promise.all([
        this.pendingArtifactUsage(tx, { screenplayId }),
        this.pendingArtifactUsage(tx, {}),
        tx.storageObject.aggregate({
          where: { status: { in: [...PENDING_STATUSES] } },
          _count: { id: true },
          _sum: { sizeBytes: true },
        }),
      ]);
      this.assertPendingCapacity(input.sizeBytes, {
        screenplayPending,
        instanceCount: artifactPending.count + storagePending._count.id,
        instanceBytes: artifactPending.bytes + (storagePending._sum.sizeBytes ?? 0n),
      });
      const id = randomUUID();
      return tx.screenplayImportArtifact.create({
        data: {
          id,
          screenplayId,
          createdByUserId: userId,
          objectKey: `screenplay-imports/${screenplayId}/${id}/original`,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          sourceFormat: input.sourceFormat,
        },
      });
    });
  }

  private async pendingArtifactUsage(
    tx: Prisma.TransactionClient,
    where: { screenplayId?: string },
  ): Promise<{ count: number; bytes: bigint }> {
    const usage = await tx.screenplayImportArtifact.aggregate({
      where: { ...where, status: { in: [...PENDING_STATUSES] } },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    return { count: usage._count.id, bytes: usage._sum.sizeBytes ?? 0n };
  }

  private assertPendingCapacity(
    sizeBytes: number,
    usage: {
      screenplayPending: { count: number; bytes: bigint };
      instanceCount: number;
      instanceBytes: bigint;
    },
  ): void {
    const requested = BigInt(sizeBytes);
    if (
      usage.screenplayPending.count >= env().STORAGE_PENDING_MAX_OBJECTS ||
      usage.screenplayPending.bytes + requested > BigInt(env().STORAGE_PENDING_MAX_BYTES) ||
      usage.instanceCount >= env().STORAGE_PENDING_INSTANCE_MAX_OBJECTS ||
      usage.instanceBytes + requested > BigInt(env().STORAGE_PENDING_INSTANCE_MAX_BYTES)
    ) {
      throw new ConflictException('Incomplete upload capacity is exhausted');
    }
  }

  private async pendingArtifact(screenplayId: string, artifactId: string) {
    await this.assertActiveScreenplay(screenplayId);
    const artifact = await this.prisma.screenplayImportArtifact.findFirst({
      where: { id: artifactId, screenplayId, status: 'PENDING' },
    });
    if (!artifact) throw new NotFoundException('Pending screenplay import artifact not found');
    return artifact;
  }

  private async statOrFail(artifact: ScreenplayImportArtifact) {
    try {
      return await this.blobs.active().stat(artifact.objectKey);
    } catch {
      await this.failPending(artifact);
      throw new BadRequestException('Reserved original upload is missing');
    }
  }

  private async failPending(artifact: ScreenplayImportArtifact): Promise<void> {
    await this.prisma.screenplayImportArtifact.updateMany({
      where: { id: artifact.id, status: 'PENDING', version: artifact.version },
      data: { status: 'FAILED', failedAt: new Date(), version: { increment: 1 } },
    });
  }

  private async assertActiveScreenplay(screenplayId: string): Promise<void> {
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { id: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
  }

  private serializeMetadata(artifact: ScreenplayImportArtifact) {
    return { ...artifact, sizeBytes: Number(artifact.sizeBytes), conversionReport: undefined };
  }

  private serializeReady(artifact: ScreenplayImportArtifact) {
    return {
      ...this.serializeMetadata(artifact),
      conversionReport: screenplayConversionReportSchema.parse(artifact.conversionReport),
    };
  }
}
