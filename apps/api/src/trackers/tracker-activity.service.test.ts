import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { TrackerActivityService } from './tracker-activity.service';

const TRACKER = '10000000-0000-4000-8000-000000000001';

function permissions() {
  return { assert: vi.fn().mockResolvedValue({}) };
}

function prismaMock() {
  return {
    activityEvent: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function service(prisma = prismaMock(), permissionDoubles = permissions()) {
  return {
    service: new TrackerActivityService(prisma as never, permissionDoubles as never),
    prisma,
    permissions: permissionDoubles,
  };
}

function lastRow(client: { activityEvent: { create: ReturnType<typeof vi.fn> } }) {
  const calls = client.activityEvent.create.mock.calls as Array<
    [{ data: Record<string, unknown> }]
  >;
  return calls[calls.length - 1]![0].data;
}

// The null-project invariant: a tracker event names its tracker and never carries a project.
function expectTrackerScoped(data: Record<string, unknown>) {
  expect(data.trackerId).toBe(TRACKER);
  expect(data.actorId).toBe('actor-id');
  expect(Object.keys(data)).not.toContain('projectId');
}

describe('TrackerActivityService writers', () => {
  it('writes tracker lifecycle events without a project id', async () => {
    const { service: target, prisma } = service();
    await target.created(TRACKER, 'actor-id');
    await target.renamed(TRACKER, 'actor-id');
    await target.deleted(TRACKER, 'actor-id');

    const rows = (prisma.activityEvent.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );
    expect(rows).toEqual([
      { trackerId: TRACKER, actorId: 'actor-id', action: 'CREATED', resourceType: 'tracker' },
      { trackerId: TRACKER, actorId: 'actor-id', action: 'UPDATED', resourceType: 'tracker' },
      { trackerId: TRACKER, actorId: 'actor-id', action: 'DELETED', resourceType: 'tracker' },
    ]);
  });

  it('routes field, record, and comment events through the transaction client when given one', async () => {
    const { service: target, prisma } = service();
    const tx = { activityEvent: { create: vi.fn().mockResolvedValue({}) } };

    await target.fieldChanged(TRACKER, 'actor-id', 'field-1', 'UPDATED', tx as never);
    await target.recordChanged(TRACKER, 'actor-id', 'CREATED', ['record-1'], tx as never);
    await target.commentAdded(TRACKER, 'actor-id', 'comment-1', tx as never);

    expect(tx.activityEvent.create).toHaveBeenCalledTimes(3);
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
    expectTrackerScoped(lastRow(tx));
    expect(lastRow(tx)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'COMMENTED',
      resourceType: 'tracker_comment',
      resourceId: 'comment-1',
    });
  });

  it('summarises multi-record changes into one event with the ids in metadata', async () => {
    const { service: target, prisma } = service();
    await target.recordChanged(TRACKER, 'actor-id', 'DELETED', ['record-1', 'record-2']);

    expectTrackerScoped(lastRow(prisma));
    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'DELETED',
      resourceType: 'tracker_record',
      metadata: { ids: ['record-1', 'record-2'] },
    });

    await target.recordChanged(TRACKER, 'actor-id', 'UPDATED', ['record-1']);
    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'UPDATED',
      resourceType: 'tracker_record',
      resourceId: 'record-1',
    });
  });

  it('strips invitee emails from invitation metadata before it is persisted', async () => {
    const { service: target, prisma } = service();
    await target.invitationCreated(TRACKER, 'actor-id', 'invite-1', {
      email: 'invitee@example.test',
      roleId: 'role-id',
    });

    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'INVITED',
      resourceType: 'tracker_invitation',
      resourceId: 'invite-1',
      metadata: { roleId: 'role-id' },
    });
  });

  it('emits membership and layout publication events for the sibling surfaces', async () => {
    const { service: target, prisma } = service();
    await target.memberAdded(TRACKER, 'actor-id', 'member-1');
    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'ACCEPTED',
      resourceType: 'tracker_member',
      resourceId: 'member-1',
    });

    await target.memberRemoved(TRACKER, 'actor-id', 'member-1');
    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'DELETED',
      resourceType: 'tracker_member',
      resourceId: 'member-1',
    });

    await target.layoutPublished(TRACKER, 'actor-id', { revision: 3 });
    expect(lastRow(prisma)).toEqual({
      trackerId: TRACKER,
      actorId: 'actor-id',
      action: 'UPDATED',
      resourceType: 'tracker_layout',
      metadata: { revision: 3 },
    });
  });
});

describe('TrackerActivityService activity feed', () => {
  it('gates on read_tracker and pages like the project feed', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const assert = vi.fn().mockResolvedValue({});
    const { service: target, permissions } = service(
      { activityEvent: { create: vi.fn(), findMany } },
      { assert },
    );

    await target.activity('reader-id', TRACKER, 'cursor-event');

    expect(permissions.assert).toHaveBeenCalledWith('reader-id', TRACKER, 'read_tracker');
    expect(findMany).toHaveBeenCalledWith({
      where: { trackerId: TRACKER },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: { id: 'cursor-event' },
      skip: 1,
      take: 100,
    });
  });

  it('redacts invitation emails on read while preserving every other metadata shape', async () => {
    const rows = [
      {
        id: 'event-1',
        trackerId: TRACKER,
        projectId: null,
        action: 'INVITED',
        resourceType: 'tracker_invitation',
        metadata: { email: 'invitee@example.test', roleId: 'role-id' } as Prisma.JsonValue,
      },
      {
        id: 'event-2',
        trackerId: TRACKER,
        projectId: null,
        action: 'COMMENTED',
        resourceType: 'tracker_comment',
        metadata: { note: 'kept' } as Prisma.JsonValue,
      },
    ];
    const { service: target } = service({
      activityEvent: { create: vi.fn(), findMany: vi.fn().mockResolvedValue(rows) },
    });

    const events = await target.activity('reader-id', TRACKER);

    expect(events[0]?.metadata).toEqual({ roleId: 'role-id' });
    expect(events[1]?.metadata).toEqual({ note: 'kept' });
  });
});
