import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateScreenplay, ImportScreenplay, UpdateScreenplay } from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  fountainFilenameFromTitle,
  normalizeImportedFilename,
  titleFromFountain,
} from './screenplay-filename';

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

const screenplayDetailSelection = {
  ...screenplayListSelection,
  sourceText: true,
} as const;

@Injectable()
export class ScreenplaysService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.screenplay.findMany({
      where: { ownerUserId: userId },
      orderBy: { updatedAt: 'desc' },
      select: screenplayListSelection,
    });
  }

  async create(userId: string, input: CreateScreenplay) {
    return this.prisma.screenplay.create({
      data: {
        ownerUserId: userId,
        title: input.title,
        filename: fountainFilenameFromTitle(input.title),
        sourceText: input.sourceText ?? '',
        paperSize: input.paperSize ?? 'letter',
      },
      select: screenplayDetailSelection,
    });
  }

  async import(userId: string, input: ImportScreenplay) {
    const filename = normalizeImportedFilename(input.filename);
    return this.prisma.screenplay.create({
      data: {
        ownerUserId: userId,
        title: titleFromFountain(filename, input.sourceText),
        filename,
        sourceText: input.sourceText,
        paperSize: input.paperSize ?? 'letter',
      },
      select: screenplayDetailSelection,
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
    try {
      return await this.prisma.screenplay.update({
        where: { id: screenplayId, ownerUserId: userId, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
          ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
          version: { increment: 1 },
        },
        select: screenplayDetailSelection,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2025') {
        throw error;
      }
      const screenplay = await this.prisma.screenplay.findFirst({
        where: { id: screenplayId, ownerUserId: userId },
        select: { id: true },
      });
      if (!screenplay) throw new NotFoundException('Screenplay not found');
      throw new ConflictException('Screenplay was modified by another session');
    }
  }
}
