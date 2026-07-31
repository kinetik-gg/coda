import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateScreenplay,
  CreateScreenplayCheckpoint,
  ImportScreenplay,
  ListScreenplaysQuery,
  UpdateScreenplay,
} from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplaySpacesService } from './screenplay-spaces.service';
import {
  fountainFilenameFromTitle,
  normalizeImportedFilename,
  titleFromFountain,
} from './screenplay-filename';
import { SCREENPLAY_LIMITS, type ScreenplayLimits } from './screenplay-limits';
import { ScreenplayPermissionService } from './screenplay-permission.service';
import { provisionScreenplayAccess } from './screenplay-roles';
import { ScreenplayCollabSourceWriteService } from './collab/screenplay-collab-source-write.service';

const screenplayListSelection = {
  id: true,
  ownerUserId: true,
  title: true,
  filename: true,
  paperSize: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

const screenplayDetailSelection = { ...screenplayListSelection, sourceText: true } as const;
const checkpointSelection = {
  id: true,
  screenplayId: true,
  screenplayVersion: true,
  filename: true,
  paperSize: true,
  sourceByteLength: true,
  createdAt: true,
} as const;
const checkpointExportSelection = { ...checkpointSelection, sourceText: true } as const;

type CheckpointWithSource = Prisma.ScreenplayRevisionGetPayload<{
  select: typeof checkpointExportSelection;
}>;

/**
 * Narrows a checkpoint row to the fields the checkpoint route has always returned. The Fountain
 * source is deliberately dropped: `POST /checkpoints` reports that a snapshot exists, and
 * `GET /checkpoints/:id/export` is the route that hands the text back.
 */
function checkpointMetadata(revision: CheckpointWithSource) {
  return {
    id: revision.id,
    screenplayId: revision.screenplayId,
    screenplayVersion: revision.screenplayVersion,
    filename: revision.filename,
    paperSize: revision.paperSize,
    sourceByteLength: revision.sourceByteLength,
    createdAt: revision.createdAt,
  };
}
const cursorSchema = z.object({ updatedAt: z.string().datetime(), id: z.string().uuid() });

function sourceBytes(sourceText: string): number {
  return Buffer.byteLength(sourceText, 'utf8');
}

function decodeCursor(cursor: string) {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Invalid screenplay cursor');
  }
}

function encodeCursor(value: { updatedAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: value.updatedAt.toISOString(), id: value.id }),
  ).toString('base64url');
}

function knownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class ScreenplaysService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCREENPLAY_LIMITS) private readonly limits: ScreenplayLimits,
    private readonly permissions: ScreenplayPermissionService,
    private readonly spaces: ScreenplaySpacesService,
    // Required, not optional, for the same reason the gateway's projection dependency is (#264):
    // this is what keeps `sourceText` and the collaborative document from diverging (#343), and a
    // missing provider must fail to boot rather than silently select the unguarded write path.
    private readonly collabSource: ScreenplayCollabSourceWriteService,
  ) {}

  async list(userId: string, query: ListScreenplaysQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    // Memberships carry a plain `screenplayId` (no relation onto Screenplay), so resolve the
    // caller's screenplay ids first, then page the screenplays themselves.
    const memberships = await this.prisma.screenplayMembership.findMany({
      where: { userId },
      select: { screenplayId: true },
    });
    const directIds = memberships.map((membership) => membership.screenplayId);
    const accessibleIds = await this.spaces.listAccessibleIds(userId, directIds, query.spaceId);
    const rows = await this.prisma.screenplay.findMany({
      where: {
        id: { in: accessibleIds },
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: new Date(cursor.updatedAt) } },
                { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: screenplayListSelection,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data.at(-1);
    return { data, nextCursor: hasMore && last ? encodeCursor(last) : null };
  }

  async create(userId: string, input: CreateScreenplay) {
    const spaceId = await this.spaces.authorizeTarget(userId, input.spaceId);
    const sourceText = input.sourceText ?? '';
    return this.createWithinQuota(
      userId,
      {
        ownerUserId: userId,
        title: input.title,
        filename: fountainFilenameFromTitle(input.title),
        sourceText,
        sourceByteLength: sourceBytes(sourceText),
        paperSize: input.paperSize ?? 'letter',
      },
      spaceId,
    );
  }

  async import(userId: string, input: ImportScreenplay) {
    const spaceId = await this.spaces.authorizeTarget(userId, input.spaceId);
    const filename = normalizeImportedFilename(input.filename);
    return this.createWithinQuota(
      userId,
      {
        ownerUserId: userId,
        title: titleFromFountain(filename, input.sourceText),
        filename,
        sourceText: input.sourceText,
        sourceByteLength: sourceBytes(input.sourceText),
        paperSize: input.paperSize ?? 'letter',
      },
      spaceId,
    );
  }

  async get(userId: string, screenplayId: string) {
    // `assert` returns the caller's membership; its role permissions are surfaced as `access` so the
    // editor can render permission-aware states (a read-only member sees a read-only editor) without
    // hitting the management surface, which is itself gated on `manage_screenplay_settings`.
    const membership = await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: screenplayDetailSelection,
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    return {
      ...screenplay,
      access: { permissions: membership.role.permissions.map((entry) => entry.permission) },
    };
  }

  async update(userId: string, screenplayId: string, input: UpdateScreenplay) {
    await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    if (input.sourceText !== undefined) {
      return this.updateSource(userId, screenplayId, input);
    }
    try {
      return await this.prisma.screenplay.update({
        where: { id: screenplayId, version: input.version, deletedAt: null },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
          version: { increment: 1 },
        },
        select: screenplayDetailSelection,
      });
    } catch (error) {
      return this.handleUpdateFailure(error, screenplayId);
    }
  }

  async checkpoint(userId: string, screenplayId: string, input: CreateScreenplayCheckpoint) {
    await this.permissions.assert(userId, screenplayId, 'edit_screenplay');
    return checkpointMetadata(await this.ensureCheckpoint(screenplayId, input.version));
  }

  /**
   * Creates or reuses the `ScreenplayRevision` for exactly `version` and returns it with its
   * Fountain source. **Authorization is the caller's job** — {@link checkpoint} asserts
   * `edit_screenplay` before calling this.
   *
   * Revision pinning (issue #239) reuses it with only `read_screenplay` asserted, deliberately:
   * a checkpoint copies text the pinning user is already entitled to read, never mutates the
   * mutable screenplay, and is bounded by the same per-screenplay count and per-owner byte quotas
   * enforced below, so the checkpoint quota — not a second permission — is what bounds the cost.
   */
  async ensureCheckpoint(screenplayId: string, version: number): Promise<CheckpointWithSource> {
    return this.serializable((transaction) =>
      this.ensureCheckpointWithin(transaction, screenplayId, version),
    );
  }

  /**
   * The same operation, inside a transaction the caller already opened.
   *
   * The rebase apply (#243) needs it: cutting the target revision and moving the pins onto it have
   * to be one atomic unit, and calling {@link ensureCheckpoint} from inside that unit would open a
   * *second*, independent transaction — leaving a checkpoint behind if the pin writes then rolled
   * back. The caller owes the isolation level (the apply uses `Serializable`, as this method's own
   * wrapper does) and the authorization.
   */
  async ensureCheckpointWithin(
    transaction: Prisma.TransactionClient,
    screenplayId: string,
    version: number,
  ): Promise<CheckpointWithSource> {
    const screenplay = await transaction.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: {
        id: true,
        ownerUserId: true,
        filename: true,
        paperSize: true,
        sourceText: true,
        sourceByteLength: true,
        version: true,
      },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');

    const key = {
      screenplayId_screenplayVersion: {
        screenplayId,
        screenplayVersion: version,
      },
    };
    const existing = await transaction.screenplayRevision.findUnique({
      where: key,
      select: checkpointExportSelection,
    });
    if (existing) return existing;
    if (screenplay.version !== version) {
      throw new ConflictException('Screenplay was modified by another session');
    }

    // Checkpoints are attributed to the screenplay's storage-partition owner (not the acting
    // editor) so the composite [screenplayId, ownerUserId] FK and per-owner quota hold for shared
    // screenplays too. See docs/adr-screenplay-access-control.md.
    await this.assertCheckpointQuota(
      transaction,
      screenplay.ownerUserId,
      screenplayId,
      screenplay.sourceByteLength,
    );
    await transaction.screenplayRevision.createMany({
      data: {
        screenplayId,
        ownerUserId: screenplay.ownerUserId,
        screenplayVersion: screenplay.version,
        filename: screenplay.filename,
        paperSize: screenplay.paperSize,
        sourceText: screenplay.sourceText,
        sourceByteLength: screenplay.sourceByteLength,
      },
      skipDuplicates: true,
    });
    const checkpoint = await transaction.screenplayRevision.findUnique({
      where: key,
      select: checkpointExportSelection,
    });
    if (!checkpoint) throw new ConflictException('Screenplay checkpoint could not be created');
    return checkpoint;
  }

  async getCheckpointExport(userId: string, screenplayId: string, checkpointId: string) {
    await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    const checkpoint = await this.prisma.screenplayRevision.findFirst({
      where: { id: checkpointId, screenplayId, screenplay: { deletedAt: null } },
      select: checkpointExportSelection,
    });
    if (!checkpoint) throw new NotFoundException('Screenplay checkpoint not found');
    return checkpoint;
  }

  private createWithinQuota(
    userId: string,
    data: Prisma.ScreenplayUncheckedCreateInput,
    spaceId: string,
  ) {
    return this.serializable(async (transaction) => {
      const count = await transaction.screenplay.count({ where: { ownerUserId: userId } });
      if (count >= this.limits.maxDocumentsPerOwner) {
        throw new HttpException('Screenplay document quota exceeded', 507);
      }
      const aggregate = await transaction.screenplay.aggregate({
        where: { ownerUserId: userId },
        _sum: { sourceByteLength: true },
      });
      const nextSourceByteLength = data.sourceByteLength ?? 0;
      if (
        (aggregate._sum.sourceByteLength ?? 0) + nextSourceByteLength >
        this.limits.maxSourceBytesPerOwner
      ) {
        throw new HttpException('Screenplay source storage quota exceeded', 507);
      }
      const created = await transaction.screenplay.create({
        data,
        select: screenplayDetailSelection,
      });
      // A new screenplay is provisioned with the seeded role graph and an owner-role membership so
      // the owner is resolved through the same membership path as every other member.
      await provisionScreenplayAccess(transaction, created.id, userId);
      await this.spaces.place(transaction, created.id, spaceId);
      return created;
    });
  }

  /**
   * Applies a `sourceText` write to whichever representation of the screenplay's text is currently
   * authoritative, so the two can never be left disagreeing (#343).
   *
   * With no collaboration log, `Screenplay.sourceText` is the only copy and the row write below is
   * safe — this is the adapter import's placeholder-then-PATCH ordering, and every screenplay
   * nobody has opened. Once a log exists the CRDT is the authority, and the text is routed into it
   * by {@link ScreenplayCollabSourceWriteService}, which then re-derives the column from the log.
   *
   * The re-check after the row write closes the one remaining window: a first join can bootstrap
   * the document from the pre-write text while the row write is still in flight, and would
   * otherwise be left holding stale text. Routing that text through the log afterwards is
   * idempotent when no such join happened — {@link ScreenplayCollabLogService.hasDocument} is
   * `false` and nothing runs.
   */
  private async updateSource(userId: string, screenplayId: string, input: UpdateScreenplay) {
    if (await this.collabSource.hasDocument(screenplayId)) {
      return this.updateSourceThroughCollaboration(userId, screenplayId, input);
    }
    const updated = await this.updateSourceWithinQuota(screenplayId, input);
    if (!(await this.collabSource.hasDocument(screenplayId))) return updated;
    await this.collabSource.applySourceText(screenplayId, userId, input.sourceText!);
    return this.requireScreenplay(screenplayId);
  }

  /**
   * The collaborative route. Optimistic concurrency, the metadata fields and the per-owner quota
   * are settled first, in one serializable transaction that deliberately does **not** touch
   * `sourceText` — the log write that follows owns the text, and the projection writes the column.
   *
   * The quota is pre-checked here so an over-quota request is refused before anything is appended
   * to the durable log; `ScreenplayCollabProjectionService.project` re-checks it against a fresh
   * aggregate inside its own transaction, which remains the enforcement point.
   */
  private async updateSourceThroughCollaboration(
    userId: string,
    screenplayId: string,
    input: UpdateScreenplay,
  ) {
    await this.serializable(async (transaction) => {
      const current = await transaction.screenplay.findFirst({
        where: { id: screenplayId, deletedAt: null },
        select: { sourceByteLength: true, ownerUserId: true, version: true },
      });
      if (!current) throw new NotFoundException('Screenplay not found');
      if (current.version !== input.version) {
        throw new ConflictException('Screenplay was modified by another session');
      }
      this.assertSourceQuota(
        await this.ownedSourceBytes(transaction, current.ownerUserId),
        current.sourceByteLength,
        sourceBytes(input.sourceText!),
      );
      if (input.title === undefined && input.paperSize === undefined) return;
      await transaction.screenplay.update({
        where: { id: screenplayId, version: input.version, deletedAt: null },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
          version: { increment: 1 },
        },
        select: { id: true },
      });
    });
    await this.collabSource.applySourceText(screenplayId, userId, input.sourceText!);
    return this.requireScreenplay(screenplayId);
  }

  private async requireScreenplay(screenplayId: string) {
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: screenplayDetailSelection,
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    return screenplay;
  }

  /** Quota is scoped to the storage-partition owner (Screenplay.ownerUserId), not the editor. */
  private async ownedSourceBytes(
    transaction: Prisma.TransactionClient,
    ownerUserId: string,
  ): Promise<number> {
    const aggregate = await transaction.screenplay.aggregate({
      where: { ownerUserId },
      _sum: { sourceByteLength: true },
    });
    return aggregate._sum.sourceByteLength ?? 0;
  }

  private assertSourceQuota(ownedBytes: number, currentBytes: number, nextBytes: number): void {
    if (ownedBytes - currentBytes + nextBytes > this.limits.maxSourceBytesPerOwner) {
      throw new HttpException('Screenplay source storage quota exceeded', 507);
    }
  }

  private updateSourceWithinQuota(screenplayId: string, input: UpdateScreenplay) {
    return this.serializable(async (transaction) => {
      const current = await transaction.screenplay.findFirst({
        where: { id: screenplayId, deletedAt: null },
        select: { sourceByteLength: true, ownerUserId: true },
      });
      if (!current) throw new NotFoundException('Screenplay not found');
      const nextSourceByteLength = sourceBytes(input.sourceText!);
      this.assertSourceQuota(
        await this.ownedSourceBytes(transaction, current.ownerUserId),
        current.sourceByteLength,
        nextSourceByteLength,
      );
      try {
        return await transaction.screenplay.update({
          where: { id: screenplayId, version: input.version, deletedAt: null },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            sourceText: input.sourceText,
            sourceByteLength: nextSourceByteLength,
            ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
            version: { increment: 1 },
          },
          select: screenplayDetailSelection,
        });
      } catch (error) {
        if (knownError(error, 'P2025'))
          throw new ConflictException('Screenplay was modified by another session');
        throw error;
      }
    });
  }

  private async assertCheckpointQuota(
    transaction: Prisma.TransactionClient,
    ownerUserId: string,
    screenplayId: string,
    sourceByteLength: number,
  ): Promise<void> {
    const [count, aggregate] = await Promise.all([
      transaction.screenplayRevision.count({ where: { screenplayId, ownerUserId } }),
      transaction.screenplayRevision.aggregate({
        where: { ownerUserId },
        _sum: { sourceByteLength: true },
      }),
    ]);
    if (count >= this.limits.maxCheckpointsPerScreenplay) {
      throw new HttpException('Screenplay checkpoint count quota exceeded', 507);
    }
    if (
      (aggregate._sum.sourceByteLength ?? 0) + sourceByteLength >
      this.limits.maxCheckpointBytesPerOwner
    ) {
      throw new HttpException('Screenplay checkpoint storage quota exceeded', 507);
    }
  }

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!knownError(error, 'P2034')) throw error;
        if (attempt === 2) {
          throw new ConflictException('Screenplay quota changed concurrently; retry the request');
        }
      }
    }
    throw new ConflictException('Screenplay quota check could not be completed');
  }

  private async handleUpdateFailure(error: unknown, screenplayId: string): Promise<never> {
    if (!knownError(error, 'P2025')) throw error;
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { id: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    throw new ConflictException('Screenplay was modified by another session');
  }
}
