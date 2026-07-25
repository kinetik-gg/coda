import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { screenplayLayoutSchema, type ScreenplayLayout } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';

function json(layout: ScreenplayLayout): Prisma.InputJsonValue {
  return layout as unknown as Prisma.InputJsonValue;
}

/**
 * Per-user screenplay panel layouts, mirroring the breakdown workspace-layouts contract: a
 * `get`/`save` pair guarded by an optimistic `revision`. A layout is personal UI state, so any
 * member who can read the screenplay may read and write their OWN row, keyed on the requesting user
 * (a non-member is refused as `404`, matching tenant isolation — see the access-control ADR). There
 * is no published default, so a layout is created lazily on first `save`; `get` returns `null` until
 * that first save.
 */
@Injectable()
export class ScreenplayLayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
  ) {}

  private async assertReadAccess(userId: string, screenplayId: string): Promise<void> {
    // Any member with read access owns their personal layout row; non-member -> 404. A trashed
    // screenplay is a normal-endpoint 404 for members too (the membership carries the screenplay row,
    // so no extra query is needed) — see the access-control ADR.
    const membership = await this.permissions.assert(userId, screenplayId, 'read_screenplay');
    if (membership.screenplay.deletedAt) throw new NotFoundException('Screenplay not found');
  }

  async get(userId: string, screenplayId: string) {
    await this.assertReadAccess(userId, screenplayId);
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
    await this.assertReadAccess(userId, screenplayId);
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
