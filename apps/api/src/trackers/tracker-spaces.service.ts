import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  placeResourceInSpace,
  SpaceResourceCreationService,
} from '../spaces/space-resource-creation';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * The tracker module's entire surface onto Spaces, in one collaborator — the same bundling the
 * screenplay module uses (`ScreenplaySpacesService`). `TrackersService` needs exactly three things
 * from the Spaces subsystem — where a new tracker may be created, placing it there, and narrowing a
 * list to what a Space grants — and they arrive from two different providers.
 */
@Injectable()
export class TrackerSpacesService {
  constructor(
    private readonly creation: SpaceResourceCreationService,
    private readonly resources?: SpaceResourcesService,
  ) {}

  /** Resolves and authorizes the Space a new tracker is being created in. */
  authorizeTarget(userId: string, spaceId?: string): Promise<string> {
    return this.creation.authorizeTarget(userId, spaceId);
  }

  /** Places a freshly created tracker in its container, inside the caller's transaction. */
  place(
    transaction: Pick<Prisma.TransactionClient, 'spaceResource'>,
    trackerId: string,
    spaceId: string,
  ): Promise<void> {
    return placeResourceInSpace(transaction, 'tracker', trackerId, spaceId);
  }

  /**
   * Widens (or, with `spaceId`, narrows) the caller's directly-held tracker ids to what Spaces
   * additionally grants. Falls back to the direct ids when the Spaces resource provider is absent,
   * exactly as the screenplay twin does.
   */
  listAccessibleIds(userId: string, directIds: string[], spaceId?: string): Promise<string[]> {
    if (!this.resources) return Promise.resolve(directIds);
    return this.resources.listAccessibleResourceIds(userId, 'tracker', directIds, spaceId);
  }
}
