import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { screenplayLayoutSchema, type ScreenplayLayout } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';

function json(layout: ScreenplayLayout): Prisma.InputJsonValue {
  return layout as unknown as Prisma.InputJsonValue;
}

/**
 * Per-user screenplay panel layouts, mirroring the breakdown workspace-layouts contract: a
 * `get`/`save` pair guarded by an optimistic `revision`. Screenplays are single-owner and have no
 * published default, so a layout is created lazily on first `save` (the client imports its local
 * layout once) rather than seeded at screenplay creation; `get` therefore returns `null` until
 * that first save.
 */
@Injectable()
export class ScreenplayLayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(userId: string, screenplayId: string): Promise<void> {
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, ownerUserId: userId },
      select: { id: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
  }

  async get(userId: string, screenplayId: string) {
    await this.assertOwnership(userId, screenplayId);
    return this.prisma.screenplayPanelLayout.findUnique({
      where: { screenplayId_userId: { screenplayId, userId } },
    });
  }

  async save(
    userId: string,
    screenplayId: string,
    layout: ScreenplayLayout,
    expectedRevision: number,
  ) {
    await this.assertOwnership(userId, screenplayId);
    const validated = screenplayLayoutSchema.parse(layout);
    const existing = await this.prisma.screenplayPanelLayout.findUnique({
      where: { screenplayId_userId: { screenplayId, userId } },
      select: { revision: true },
    });
    if (!existing) {
      if (expectedRevision !== 0) {
        throw new ConflictException('Screenplay layout has changed; refresh and retry');
      }
      try {
        return await this.prisma.screenplayPanelLayout.create({
          data: {
            screenplayId,
            userId,
            layout: json(validated),
            schemaVersion: validated.schemaVersion,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Screenplay layout has changed; refresh and retry');
        }
        throw error;
      }
    }
    const result = await this.prisma.screenplayPanelLayout.updateMany({
      where: { screenplayId, userId, revision: expectedRevision },
      data: {
        layout: json(validated),
        schemaVersion: validated.schemaVersion,
        revision: { increment: 1 },
      },
    });
    if (!result.count) {
      throw new ConflictException('Screenplay layout has changed; refresh and retry');
    }
    return this.prisma.screenplayPanelLayout.findUniqueOrThrow({
      where: { screenplayId_userId: { screenplayId, userId } },
    });
  }
}
