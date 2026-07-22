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
  ImportScreenplay,
  ListScreenplaysQuery,
  UpdateScreenplay,
} from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  fountainFilenameFromTitle,
  normalizeImportedFilename,
  titleFromFountain,
} from './screenplay-filename';
import { SCREENPLAY_LIMITS, type ScreenplayLimits } from './screenplay-limits';

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
  ) {}

  async list(userId: string, query: ListScreenplaysQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.screenplay.findMany({
      where: {
        ownerUserId: userId,
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

  create(userId: string, input: CreateScreenplay) {
    const sourceText = input.sourceText ?? '';
    return this.createWithinQuota(userId, {
      ownerUserId: userId,
      title: input.title,
      filename: fountainFilenameFromTitle(input.title),
      sourceText,
      sourceByteLength: sourceBytes(sourceText),
      paperSize: input.paperSize ?? 'letter',
    });
  }

  import(userId: string, input: ImportScreenplay) {
    const filename = normalizeImportedFilename(input.filename);
    return this.createWithinQuota(userId, {
      ownerUserId: userId,
      title: titleFromFountain(filename, input.sourceText),
      filename,
      sourceText: input.sourceText,
      sourceByteLength: sourceBytes(input.sourceText),
      paperSize: input.paperSize ?? 'letter',
    });
  }

  async get(userId: string, screenplayId: string) {
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, ownerUserId: userId },
      select: screenplayDetailSelection,
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    return screenplay;
  }

  async update(userId: string, screenplayId: string, input: UpdateScreenplay) {
    if (input.sourceText !== undefined) {
      return this.updateSourceWithinQuota(userId, screenplayId, input);
    }
    try {
      return await this.prisma.screenplay.update({
        where: { id: screenplayId, ownerUserId: userId, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
          version: { increment: 1 },
        },
        select: screenplayDetailSelection,
      });
    } catch (error) {
      return this.handleUpdateFailure(error, userId, screenplayId);
    }
  }

  private createWithinQuota(userId: string, data: Prisma.ScreenplayUncheckedCreateInput) {
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
      return transaction.screenplay.create({ data, select: screenplayDetailSelection });
    });
  }

  private updateSourceWithinQuota(userId: string, screenplayId: string, input: UpdateScreenplay) {
    return this.serializable(async (transaction) => {
      const current = await transaction.screenplay.findFirst({
        where: { id: screenplayId, ownerUserId: userId },
        select: { sourceByteLength: true },
      });
      if (!current) throw new NotFoundException('Screenplay not found');
      const nextSourceByteLength = sourceBytes(input.sourceText!);
      const aggregate = await transaction.screenplay.aggregate({
        where: { ownerUserId: userId },
        _sum: { sourceByteLength: true },
      });
      const nextTotal =
        (aggregate._sum.sourceByteLength ?? 0) - current.sourceByteLength + nextSourceByteLength;
      if (nextTotal > this.limits.maxSourceBytesPerOwner) {
        throw new HttpException('Screenplay source storage quota exceeded', 507);
      }
      try {
        return await transaction.screenplay.update({
          where: { id: screenplayId, ownerUserId: userId, version: input.version },
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

  private async handleUpdateFailure(
    error: unknown,
    userId: string,
    screenplayId: string,
  ): Promise<never> {
    if (!knownError(error, 'P2025')) throw error;
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, ownerUserId: userId },
      select: { id: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    throw new ConflictException('Screenplay was modified by another session');
  }
}
