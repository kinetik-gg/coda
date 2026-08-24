import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { publicActivityMetadata } from '../collaboration/activity-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerPermissionService } from './tracker-permission.service';

/**
 * The change verbs tracker events use. The shared `ActivityAction` enum already carries
 * every lifecycle this surface needs (the project feed's audit vocabulary), so no new
 * enum value is introduced: creation, mutation, and removal map onto `CREATED`,
 * `UPDATED`, and `DELETED`; invitations, membership, comments, and layout publication
 * reuse `INVITED`, `ACCEPTED`, `COMMENTED`, and `UPDATED` respectively.
 */
type TrackerChangeAction = 'CREATED' | 'UPDATED' | 'DELETED';

/** Either an open transaction or the request-scoped Prisma client. */
type EventClient = Prisma.TransactionClient | PrismaService;

interface ActivityDraft {
  action: TrackerChangeAction | 'INVITED' | 'ACCEPTED' | 'COMMENTED';
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
}

const ACTIVITY_PAGE_SIZE = 100;

/**
 * The single writer and reader for tracker-scope activity (`activity_events` rows whose
 * container is `trackerId`). Mutation services call the intent-revealing methods at their
 * natural post-commit points — ideally inside the same transaction as the change itself,
 * passing the transaction client as the trailing argument.
 *
 * Every row upholds the null-project invariant: a tracker event names its tracker and
 * never a project, so `projectId` stays unset (null) on everything written here. Invitation
 * metadata is redacted of email addresses on write, mirroring the read-side
 * `publicActivityMetadata` redaction that also covers historical rows.
 *
 * This service is the integration point for surfaces that do not exist yet: tracker
 * sharing/memberships and saved layouts will emit through {@link memberAdded},
 * {@link memberRemoved}, {@link invitationCreated}, and {@link layoutPublished}.
 */
@Injectable()
export class TrackerActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
  ) {}

  /** A tracker was created (its provisioning role graph rides in the same transaction). */
  async created(trackerId: string, actorId: string, tx?: EventClient): Promise<void> {
    await this.write({ action: 'CREATED', resourceType: 'tracker' }, trackerId, actorId, tx);
  }

  /** The tracker's name changed. */
  async renamed(trackerId: string, actorId: string, tx?: EventClient): Promise<void> {
    await this.write({ action: 'UPDATED', resourceType: 'tracker' }, trackerId, actorId, tx);
  }

  /** The tracker was soft-deleted into trash. */
  async deleted(trackerId: string, actorId: string, tx?: EventClient): Promise<void> {
    await this.write({ action: 'DELETED', resourceType: 'tracker' }, trackerId, actorId, tx);
  }

  /**
   * A field definition was created, updated (including option reconciliation), or archived
   * into trash.
   */
  async fieldChanged(
    trackerId: string,
    actorId: string,
    fieldId: string,
    action: TrackerChangeAction,
    tx?: EventClient,
  ): Promise<void> {
    await this.write(
      { action, resourceType: 'tracker_field', resourceId: fieldId },
      trackerId,
      actorId,
      tx,
    );
  }

  /**
   * One or more records changed together: creation, a bulk cell write, or a bulk soft
   * deletion. A single id lands in `resourceId`; several ids land as an `ids` list in the
   * metadata of one summary event instead of one event per row.
   */
  async recordChanged(
    trackerId: string,
    actorId: string,
    action: TrackerChangeAction,
    recordIds: readonly string[],
    tx?: EventClient,
  ): Promise<void> {
    const [primary] = recordIds;
    await this.write(
      {
        action,
        resourceType: 'tracker_record',
        ...(recordIds.length === 1 ? { resourceId: primary } : {}),
        ...(recordIds.length > 1 ? { metadata: { ids: [...recordIds] } } : {}),
      },
      trackerId,
      actorId,
      tx,
    );
  }

  /** A comment was added to a record. */
  async commentAdded(
    trackerId: string,
    actorId: string,
    commentId: string,
    tx?: EventClient,
  ): Promise<void> {
    await this.write(
      { action: 'COMMENTED', resourceType: 'tracker_comment', resourceId: commentId },
      trackerId,
      actorId,
      tx,
    );
  }

  /**
   * An invitation to join the tracker was issued. Metadata passes through the invitation
   * redaction before it reaches the database, so an invitee email is never persisted here.
   */
  async invitationCreated(
    trackerId: string,
    actorId: string,
    invitationId: string,
    metadata?: Prisma.InputJsonValue,
    tx?: EventClient,
  ): Promise<void> {
    await this.write(
      {
        action: 'INVITED',
        resourceType: 'tracker_invitation',
        resourceId: invitationId,
        ...(metadata !== undefined
          ? {
              metadata: publicActivityMetadata(
                'tracker_invitation',
                metadata as Prisma.JsonValue,
              ) as Prisma.InputJsonValue,
            }
          : {}),
      },
      trackerId,
      actorId,
      tx,
    );
  }

  /** A member joined the tracker (direct add or accepted invitation). */
  async memberAdded(trackerId: string, actorId: string, memberId: string, tx?: EventClient) {
    await this.write(
      { action: 'ACCEPTED', resourceType: 'tracker_member', resourceId: memberId },
      trackerId,
      actorId,
      tx,
    );
  }

  /** A member's membership was removed from the tracker. */
  async memberRemoved(trackerId: string, actorId: string, memberId: string, tx?: EventClient) {
    await this.write(
      { action: 'DELETED', resourceType: 'tracker_member', resourceId: memberId },
      trackerId,
      actorId,
      tx,
    );
  }

  /** A layout revision was published onto the tracker. */
  async layoutPublished(
    trackerId: string,
    actorId: string,
    metadata?: Prisma.InputJsonValue,
    tx?: EventClient,
  ): Promise<void> {
    await this.write(
      { action: 'UPDATED', resourceType: 'tracker_layout', ...(metadata ? { metadata } : {}) },
      trackerId,
      actorId,
      tx,
    );
  }

  /**
   * The tracker activity feed: up to {@link ACTIVITY_PAGE_SIZE} newest events with the
   * actor's display name attached, cursor-paginated exactly like the project feed (use the
   * last event id as the next cursor when the page is full). Requires `read_tracker`.
   */
  async activity(userId: string, trackerId: string, cursor?: string) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const events = await this.prisma.activityEvent.findMany({
      where: { trackerId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: ACTIVITY_PAGE_SIZE,
    });
    return events.map((event) => ({
      ...event,
      metadata: publicActivityMetadata(event.resourceType, event.metadata),
    }));
  }

  /**
   * Appends one event inside (or alongside) the caller's write. Tracker rows never set
   * `projectId` — the null-project invariant lives here and nowhere else.
   */
  private async write(
    draft: ActivityDraft,
    trackerId: string,
    actorId: string,
    tx?: EventClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.activityEvent.create({
      data: {
        trackerId,
        actorId,
        action: draft.action,
        resourceType: draft.resourceType,
        ...(draft.resourceId ? { resourceId: draft.resourceId } : {}),
        ...(draft.metadata !== undefined ? { metadata: draft.metadata } : {}),
      },
    });
  }
}
