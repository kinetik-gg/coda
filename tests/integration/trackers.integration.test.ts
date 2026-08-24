import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  ensureOwnerAuth,
  provisionMember,
  request,
  required,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';
import {
  addTrackerMember,
  createTracker,
  createTrackerField,
  createTrackerRecord,
  getTracker,
  listTrackerRecords,
  listTrackers,
  setTrackerRecordValue,
  valueOf,
  type TrackerActivityItem,
  type TrackerFieldView,
  type TrackerLayoutState,
  type TrackerRecordView,
  type TrackerView,
} from './support/tracker-helpers';

/**
 * S21 integration coverage, part one: the tracker aggregate's own lifecycle over the live
 * disposable stack — CRUD with optimistic versions, the fields+records grid (typed values,
 * typed filters, bulk writes), the saved-layout save/publish conflict path, and the activity
 * feed that mutations feed. Access control lives in trackers-sharing; media, CSV, and the trash
 * round-trip live in trackers-media-trash.
 */

let owner: SessionAuth;

beforeAll(async () => {
  owner = await ensureOwnerAuth();
}, 120_000);

describe('tracker CRUD', () => {
  it('creates a tracker in the personal Default Space, lists it, and renames it under version guard', async () => {
    const created = await createTracker(owner, { name: 'Integration CRUD tracker' });
    expect(created.version).toBe(1);

    const listed = await listTrackers(owner);
    expect(listed.map((tracker) => tracker.id)).toContain(created.id);

    const opened = await getTracker(owner, created.id);
    expect(opened.name).toBe('Integration CRUD tracker');
    // A freshly created owner resolves through their owner-role membership.
    expect(opened.access?.permissions).toContain('manage_tracker_settings');

    const stale = await request(
      `/api/v1/trackers/${created.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Lost race rename', version: created.version + 5 }),
      },
      owner,
    );
    expect(stale.status).toBe(409);

    const renamed = await api<JsonEnvelope<TrackerView>>(
      `/api/v1/trackers/${created.id}`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Integration CRUD tracker renamed',
          version: created.version,
        }),
      },
      owner,
    );
    expect(renamed.data.name).toBe('Integration CRUD tracker renamed');
    expect(renamed.data.version).toBe(created.version + 1);
    expect((await getTracker(owner, created.id)).name).toBe('Integration CRUD tracker renamed');
  }, 120_000);

  it('rejects an invalid tracker body before any authorization work', async () => {
    const response = await request(
      '/api/v1/trackers',
      {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      },
      owner,
    );
    expect(response.status).toBe(400);
  });
});

describe('fields + records lifecycle', () => {
  let tracker: TrackerView;
  let status: TrackerFieldView;
  let points: TrackerFieldView;
  let tags: TrackerFieldView;
  let due: TrackerFieldView;
  let note: TrackerFieldView;
  let recordA: TrackerRecordView;
  let recordB: TrackerRecordView;
  let recordC: TrackerRecordView;

  beforeAll(async () => {
    tracker = await createTracker(owner, { name: 'Integration grid tracker' });
    status = await createTrackerField(owner, tracker.id, {
      name: 'Status',
      key: 'status',
      type: 'enum',
      options: [{ label: 'Backlog' }, { label: 'In progress', color: '#3873bb' }],
    });
    points = await createTrackerField(owner, tracker.id, {
      name: 'Points',
      key: 'points',
      type: 'integer',
    });
    tags = await createTrackerField(owner, tracker.id, {
      name: 'Tags',
      key: 'tags',
      type: 'multi_enum',
      options: [{ label: 'hero' }, { label: 'vfx' }],
    });
    due = await createTrackerField(owner, tracker.id, {
      name: 'Due',
      key: 'due',
      type: 'date',
    });
    note = await createTrackerField(owner, tracker.id, {
      name: 'Note',
      key: 'note',
      type: 'text',
    });
    recordA = await createTrackerRecord(owner, tracker.id, 'Opening sequence');
    recordB = await createTrackerRecord(owner, tracker.id, 'Rooftop chase');
    recordC = await createTrackerRecord(owner, tracker.id, 'Final frame');
  }, 120_000);

  it('stores typed values and reads them back joined to their options', async () => {
    const backlogOption = required(status.options[0], 'enum field ships its options');
    let working = await setTrackerRecordValue(
      owner,
      tracker.id,
      recordA.id,
      status.id,
      { type: 'enum', optionId: backlogOption.id },
      recordA.version,
    );
    working = await setTrackerRecordValue(
      owner,
      tracker.id,
      working.id,
      points.id,
      { type: 'integer', value: 42 },
      working.version,
    );
    working = await setTrackerRecordValue(
      owner,
      tracker.id,
      working.id,
      tags.id,
      {
        type: 'multi_enum',
        optionIds: [
          required(tags.options[0], 'first tag option').id,
          required(tags.options[1], 'second tag option').id,
        ],
      },
      working.version,
    );
    working = await setTrackerRecordValue(
      owner,
      tracker.id,
      working.id,
      due.id,
      { type: 'date', value: '2026-09-01' },
      working.version,
    );
    const dated = await setTrackerRecordValue(
      owner,
      tracker.id,
      working.id,
      note.id,
      { type: 'text', value: 'Hold on the final frame' },
      working.version,
    );
    expect(dated.version).toBeGreaterThan(recordA.version);

    const stored = (await listTrackerRecords(owner, tracker.id)).data.find(
      (record) => record.id === recordA.id,
    );
    expect(stored).toBeDefined();
    if (!stored) return;
    expect(valueOf(stored, status.id).option?.label).toBe('Backlog');
    expect(valueOf(stored, points.id).integerValue).toBe(42);
    expect(valueOf(stored, tags.id).options?.map((entry) => entry.option.label)).toEqual([
      'hero',
      'vfx',
    ]);
    expect(valueOf(stored, due.id).dateValue).toBe('2026-09-01T00:00:00.000Z');
    expect(valueOf(stored, note.id).textValue).toBe('Hold on the final frame');

    // Clearing a cell deletes the value row instead of storing a null.
    const cleared = await setTrackerRecordValue(
      owner,
      tracker.id,
      stored.id,
      note.id,
      null,
      stored.version,
    );
    expect(cleared.values.some((value) => value.fieldId === note.id)).toBe(false);
  }, 120_000);

  it('refuses a typed value that contradicts the field definition', async () => {
    const current = await api<JsonEnvelope<TrackerRecordView>>(
      `/api/v1/trackers/${tracker.id}/records/${recordA.id}`,
      200,
      {},
      owner,
    );
    const version = current.data.version;
    const response = await request(
      `/api/v1/trackers/${tracker.id}/records/${recordA.id}/fields/${points.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value: { type: 'text', value: '42' }, recordVersion: version }),
      },
      owner,
    );
    expect(response.status).toBe(400);
    const wrongEnumOption = await request(
      `/api/v1/trackers/${tracker.id}/records/${recordA.id}/fields/${status.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          value: { type: 'enum', optionId: required(tags.options[0], 'first tag option').id },
          recordVersion: version,
        }),
      },
      owner,
    );
    // A foreign option id is a definition violation, distinct from the version guard.
    expect(wrongEnumOption.status).toBe(400);
  });

  it('guards cell writes on the record version', async () => {
    const response = await request(
      `/api/v1/trackers/${tracker.id}/records/${recordA.id}/fields/${points.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value: { type: 'integer', value: 7 }, recordVersion: 999 }),
      },
      owner,
    );
    expect(response.status).toBe(409);
  });

  it('filters records by enum option, emptiness, number range, and title search', async () => {
    const inProgressOption = required(status.options[1], 'second enum option exists');
    const chase = await setTrackerRecordValue(
      owner,
      tracker.id,
      recordB.id,
      status.id,
      { type: 'enum', optionId: inProgressOption.id },
      recordB.version,
    );
    await setTrackerRecordValue(
      owner,
      tracker.id,
      chase.id,
      points.id,
      { type: 'integer', value: 13 },
      chase.version,
    );

    const byOption = await listTrackerRecords(owner, tracker.id, {
      filters: [{ fieldId: status.id, operator: 'equals', value: inProgressOption.id }],
    });
    expect(byOption.data.map((record) => record.title)).toEqual(['Rooftop chase']);

    // Opening sequence still carries its Backlog value from the typed-values scenario above.
    const unassigned = await listTrackerRecords(owner, tracker.id, {
      filters: [{ fieldId: status.id, operator: 'is_empty' }],
    });
    expect(unassigned.data.map((record) => record.title)).toEqual(['Final frame']);

    const busy = await listTrackerRecords(owner, tracker.id, {
      filters: [{ fieldId: points.id, operator: 'greater_than', value: 10 }],
    });
    // Opening sequence carries its 42-point value from the typed-values scenario.
    expect(busy.data.map((record) => record.title)).toEqual(['Opening sequence', 'Rooftop chase']);

    const searched = await listTrackerRecords(owner, tracker.id, { search: 'rooftop' });
    expect(searched.data.map((record) => record.title)).toEqual(['Rooftop chase']);

    const combined = await listTrackerRecords(owner, tracker.id, {
      filters: [
        { fieldId: status.id, operator: 'not_equals', value: inProgressOption.id },
        { fieldId: points.id, operator: 'is_not_empty' },
      ],
    });
    expect(combined.data.map((record) => record.title)).toEqual(['Opening sequence']);
  }, 120_000);

  it('applies bulk cell writes atomically and reports every touched record', async () => {
    const inProgress = required(status.options[1], 'second status option');
    const beforeBulk = await api<JsonEnvelope<TrackerRecordView>>(
      `/api/v1/trackers/${tracker.id}/records/${recordA.id}`,
      200,
      {},
      owner,
    );
    const result = await api<JsonEnvelope<{ records: TrackerRecordView[] }>>(
      `/api/v1/trackers/${tracker.id}/records/bulk-set`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          updates: [
            {
              recordId: recordA.id,
              fieldId: status.id,
              value: { type: 'enum', optionId: inProgress.id },
            },
            { recordId: recordA.id, fieldId: points.id, value: { type: 'integer', value: 8 } },
            { recordId: recordC.id, fieldId: points.id, value: { type: 'integer', value: 21 } },
          ],
        }),
      },
      owner,
    );
    const byId = new Map(result.data.records.map((record) => [record.id, record]));
    expect(byId.size).toBe(2);
    const updatedA = required(byId.get(recordA.id), 'bulk response carries record A');
    expect(valueOf(updatedA, status.id).option?.label).toBe('In progress');
    expect(valueOf(updatedA, points.id).integerValue).toBe(8);
    // One version bump for the record regardless of how many of its cells changed.
    expect(updatedA.version).toBe(beforeBulk.data.version + 1);
    const updatedC = required(byId.get(recordC.id), 'bulk response carries record C');
    expect(valueOf(updatedC, points.id).integerValue).toBe(21);

    const foreignField = await request(
      `/api/v1/trackers/${tracker.id}/records/bulk-set`,
      {
        method: 'POST',
        body: JSON.stringify({
          updates: [
            {
              recordId: recordC.id,
              fieldId: '00000000-0000-4000-8000-0000000000ff',
              value: { type: 'integer', value: 1 },
            },
          ],
        }),
      },
      owner,
    );
    expect(foreignField.status).toBe(400);
  }, 120_000);

  it('soft-deletes records in bulk and leaves them out of every later listing', async () => {
    const doomed = await createTrackerRecord(owner, tracker.id, 'Cut scene');
    const second = await createTrackerRecord(owner, tracker.id, 'Alternate take');
    const deleted = await api<JsonEnvelope<{ deletedIds: string[]; deletionBatchId: string }>>(
      `/api/v1/trackers/${tracker.id}/records/bulk-delete`,
      201,
      { method: 'POST', body: JSON.stringify({ ids: [doomed.id, second.id] }) },
      owner,
    );
    expect(deleted.data.deletedIds.sort()).toEqual([doomed.id, second.id].sort());
    const remaining = await listTrackerRecords(owner, tracker.id);
    expect(remaining.data.map((record) => record.id)).not.toContain(doomed.id);
    const emptyBatch = await request(
      `/api/v1/trackers/${tracker.id}/records/bulk-delete`,
      {
        method: 'POST',
        body: JSON.stringify({ ids: [doomed.id] }),
      },
      owner,
    );
    expect(emptyBatch.status).toBe(404);
  }, 120_000);
});

describe('workspace layouts', () => {
  it('saves personal layouts CAS-on-revision and hits the publish conflict path', async () => {
    const tracker = await createTracker(owner, { name: 'Integration layout tracker' });
    const initial = await api<JsonEnvelope<TrackerLayoutState>>(
      `/api/v1/trackers/${tracker.id}/workspace-layout`,
      200,
      {},
      owner,
    );
    expect(initial.data.personal.revision).toBe(0);
    expect(initial.data.canPublish).toBe(true);

    const saved = await api<JsonEnvelope<TrackerLayoutState['personal']>>(
      `/api/v1/trackers/${tracker.id}/workspace-layout`,
      200,
      {
        method: 'PUT',
        body: JSON.stringify({
          layout: initial.data.personal.layout,
          expectedRevision: initial.data.personal.revision,
        }),
      },
      owner,
    );
    expect(saved.data.revision).toBe(1);

    const staleSave = await request(
      `/api/v1/trackers/${tracker.id}/workspace-layout`,
      {
        method: 'PUT',
        body: JSON.stringify({
          layout: initial.data.personal.layout,
          expectedRevision: initial.data.personal.revision,
        }),
      },
      owner,
    );
    expect(staleSave.status).toBe(409);

    const published = await api<JsonEnvelope<TrackerLayoutState['default']>>(
      `/api/v1/trackers/${tracker.id}/workspace-layout/publish`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          personalRevision: saved.data.revision,
          defaultRevision: initial.data.default.revision,
        }),
      },
      owner,
    );
    expect(published.data.revision).toBe(initial.data.default.revision + 1);

    const replayedPublish = await request(
      `/api/v1/trackers/${tracker.id}/workspace-layout/publish`,
      {
        method: 'POST',
        body: JSON.stringify({
          personalRevision: saved.data.revision,
          defaultRevision: initial.data.default.revision,
        }),
      },
      owner,
    );
    expect(replayedPublish.status).toBe(409);
  }, 120_000);

  it('lets a member save a personal layout but never publish one', async () => {
    const tracker = await createTracker(owner, { name: 'Integration layout permissions' });
    const member = await provisionMember(owner);
    await addTrackerMember(owner, tracker.id, 'viewer', member);

    const view = await api<JsonEnvelope<TrackerLayoutState>>(
      `/api/v1/trackers/${tracker.id}/workspace-layout`,
      200,
      {},
      member,
    );
    expect(view.data.canPublish).toBe(false);
    const denied = await request(
      `/api/v1/trackers/${tracker.id}/workspace-layout/publish`,
      {
        method: 'POST',
        body: JSON.stringify({
          personalRevision: view.data.personal.revision,
          defaultRevision: view.data.default.revision,
        }),
      },
      member,
    );
    expect(denied.status).toBe(403);
  }, 120_000);
});

describe('activity feed', () => {
  it('surfaces entries for the mutations performed against the tracker', async () => {
    const tracker = await createTracker(owner, { name: 'Integration activity tracker' });
    const field = await createTrackerField(owner, tracker.id, {
      name: 'Status',
      key: 'status',
      type: 'enum',
      options: [{ label: 'Open' }],
    });
    const record = await createTrackerRecord(owner, tracker.id, 'First entry');
    await api(
      `/api/v1/trackers/${tracker.id}/records/bulk-set`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          updates: [
            {
              recordId: record.id,
              fieldId: field.id,
              value: { type: 'enum', optionId: required(field.options[0], 'enum option').id },
            },
          ],
        }),
      },
      owner,
    );

    const feed = await api<JsonEnvelope<TrackerActivityItem[]>>(
      `/api/v1/trackers/${tracker.id}/activity`,
      200,
      {},
      owner,
    );
    const shapes = feed.data.map((event) => `${event.action}:${event.resourceType}`);
    expect(shapes).toEqual([
      'UPDATED:tracker_record',
      'CREATED:tracker_record',
      'CREATED:tracker_field',
      'CREATED:tracker',
    ]);
    for (const event of feed.data) {
      expect(event.projectId ?? null).toBeNull();
      expect(event.trackerId).toBe(tracker.id);
    }
  }, 120_000);
});
