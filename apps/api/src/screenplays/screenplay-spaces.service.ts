import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  placeResourceInSpace,
  SpaceResourceCreationService,
} from '../spaces/space-resource-creation';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * The screenplay module's entire surface onto Spaces, in one collaborator.
 *
 * `ScreenplaysService` needs exactly three things from the Spaces subsystem — where a new
 * screenplay may be created, placing it there, and narrowing a list to what a Space grants — and
 * they arrive from two different providers. Bundling them keeps the screenplay service's own
 * dependency list about screenplays, and gives the Spaces coupling a single documented seam rather
 * than two incidental ones.
 */
@Injectable()
export class ScreenplaySpacesService {
  constructor(
    private readonly creation: SpaceResourceCreationService,
    private readonly resources?: SpaceResourcesService,
  ) {}

  /** Resolves and authorizes the Space a new screenplay is being created in. */
  authorizeTarget(userId: string, spaceId?: string): Promise<string> {
    return this.creation.authorizeTarget(userId, spaceId);
  }

  /** Places a freshly created screenplay in its container, inside the caller's transaction. */
  place(
    transaction: Pick<Prisma.TransactionClient, 'spaceResource'>,
    screenplayId: string,
    spaceId: string,
  ): Promise<void> {
    return placeResourceInSpace(transaction, 'screenplay', screenplayId, spaceId);
  }

  /**
   * Widens (or, with `spaceId`, narrows) the caller's directly-held screenplay ids to what Spaces
   * additionally grants. Falls back to the direct ids when the Spaces resource provider is absent,
   * exactly as the inline call it replaced did.
   */
  listAccessibleIds(userId: string, directIds: string[], spaceId?: string): Promise<string[]> {
    if (!this.resources) return Promise.resolve(directIds);
    return this.resources.listAccessibleResourceIds(userId, 'screenplay', directIds, spaceId);
  }
}
