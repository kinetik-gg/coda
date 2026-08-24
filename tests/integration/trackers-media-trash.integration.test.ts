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
import { databaseReachable, queryDatabase } from './support/postgres';
import {
  createTracker,
  createTrackerField,
  createTrackerRecord,
  listTrackerRecords,
  provisionTrackerMember,
  restoreTrackerApi,
  purgeTrackerApi,
  setTrackerRecordValue,
  trashTracker,
} from './support/tracker-helpers';

/**
 * S21 integration coverage, part three: the tracker's media and lifecycle edges. The S3 upload
 * round-trip through the tracker-scoped storage family, the streamed record CSV export shape,
 * and the full trash → restore → purge round-trip including the blob-reclamation enqueue.
 * Access control lives in trackers-sharing; grid mechanics live in trackers.
 */

let owner: SessionAuth;

beforeAll(async () => {
  owner = await ensureOwnerAuth();
}, 120_000);

describe('tracker media uploads (S3 lane)', () => {
  it('round-trips bytes from presigned reserve to authorized read', async () => {
    const tracker = await createTracker(owner, { name: 'Integration media tracker' });
    const payload = Buffer.from(`tracker-media-${Date.now()}-${'y'.repeat(64)}`);

    const reserved = await api<
      JsonEnvelope<{ id: string; version: number; uploadUrl: string; directUpload: boolean }>
    >(`/api/v1/trackers/${tracker.id}/uploads`, 201, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'file',
        filename: 'storyboard-frame.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: payload.byteLength,
      }),
    }, owner);
    const uploadId = reserved.data.id;
    expect(reserved.data.directUpload).toBe(true);

    const put = await fetch(reserved.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
      body: new Uint8Array(payload),
    });
    expect(put.status).toBe(200);

    await api<JsonEnvelope<{ id: string; status: string }>>(
      `/api/v1/trackers/${tracker.id}/uploads/${uploadId}/complete`,
      201,
      { method: 'POST', body: JSON.stringify({ version: reserved.data.version }) },
      owner,
    );

    const read = await api<JsonEnvelope<{ url: string }>>(
      `/api/v1/trackers/${tracker.id}/storage-objects/${uploadId}/content`,
      200,
      {},
      owner,
    );
    const downloaded = await fetch(read.data.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(payload);
  }, 120_000);

  it('rejects source documents and unknown media objects on the tracker surface', async () => {
    const tracker = await createTracker(owner, { name: 'Integration media rejections' });
    const sourceDocument = await request(`/api/v1/trackers/${tracker.id}/uploads`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'source_document',
        filename: 'script.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      }),
    }, owner);
    expect(sourceDocument.status).toBe(400);

    const missingObject = await request(
      `/api/v1/trackers/${tracker.id}/storage-objects/00000000-0000-4000-8000-0000000000ff/content`,
      {},
      owner,
    );
    expect(missingObject.status).toBe(404);
  });
});

describe('record CSV export', () => {
  it('streams the filtered record grid as an attachment with one column per field', async () => {
    const tracker = await createTracker(owner, { name: 'Integration Export Tracker' });
    const status = await createTrackerField(owner, tracker.id, {
      name: 'Status',
      key: 'status',
      type: 'enum',
      options: [{ label: 'Backlog' }, { label: 'Shipped' }],
    });
    const points = await createTrackerField(owner, tracker.id, {
      name: 'Points',
      key: 'points',
      type: 'integer',
    });
    const shipped = required(status.options[1], 'second option');
    const first = await createTrackerRecord(owner, tracker.id, 'Alpha row');
    const second = await createTrackerRecord(owner, tracker.id, 'Beta row');
    await setTrackerRecordValue(
      owner, tracker.id, first.id, status.id,
      { type: 'enum', optionId: shipped.id }, first.version,
    );
    await setTrackerRecordValue(
      owner, tracker.id, second.id, points.id,
      { type: 'integer', value: 5 }, second.version,
    );

    const response = await request(
      `/api/v1/trackers/${tracker.id}/exports/records.csv`,
      {},
      owner,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="integration-export-tracker.csv"',
    );

    const text = await response.text();
    const rows = text.split('\r\n').filter(Boolean);
    expect(rows[0]).toBe('id,title,Status,Points');
    const alpha = rows.find((row) => row.includes('Alpha row'));
    const beta = rows.find((row) => row.includes('Beta row'));
    expect(alpha?.endsWith(',Shipped,')).toBe(true);
    expect(beta?.endsWith(',5')).toBe(true);

    // The export speaks the list endpoint's filter vocabulary, minus pagination.
    const filtered = await request(
      `/api/v1/trackers/${tracker.id}/exports/records.csv?filters=${encodeURIComponent(
        JSON.stringify([{ fieldId: status.id, operator: 'equals', value: shipped.id }]),
      )}`,
      {},
      owner,
    );
    const filteredText = await filtered.text();
    expect(filteredText).toContain('Alpha row');
    expect(filteredText).not.toContain('Beta row');

    const paginated = await request(
      `/api/v1/trackers/${tracker.id}/exports/records.csv?limit=1`,
      {},
      owner,
    );
    expect(paginated.status).toBe(400);
  }, 120_000);

  it('answers a member but not a stranger', async () => {
    const tracker = await createTracker(owner, { name: 'Integration export access' });
    await createTrackerRecord(owner, tracker.id, 'Row');
    const stranger = await provisionMember(owner);
    expect((await request(`/api/v1/trackers/${tracker.id}/exports/records.csv`, {}, stranger)).status)
      .toBe(404);
  }, 120_000);
});

describe('trash → restore → purge round-trip', () => {
  it('recovers a trashed tracker intact and purges it down to the blob-reclamation queue', async () => {
    const tracker = await createTracker(owner, { name: 'Integration lifecycle tracker' });
    const field = await createTrackerField(owner, tracker.id, {
      name: 'Note',
      key: 'note',
      type: 'text',
    });
    const record = await createTrackerRecord(owner, tracker.id, 'Lifecycle row');
    await setTrackerRecordValue(
      owner, tracker.id, record.id, field.id,
      { type: 'text', value: 'survives trash' }, record.version,
    );
    const payload = Buffer.from(`lifecycle-media-${Date.now()}`);
    const reserved = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
      `/api/v1/trackers/${tracker.id}/uploads`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'file',
          filename: 'lifecycle.bin',
          mimeType: 'application/octet-stream',
          sizeBytes: payload.byteLength,
        }),
      },
      owner,
    );
    expect(
      (
        await fetch(reserved.data.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
          body: new Uint8Array(payload),
        })
      ).status,
    ).toBe(200);
    await api(`/api/v1/trackers/${tracker.id}/uploads/${reserved.data.id}/complete`, 201, {
      method: 'POST',
      body: JSON.stringify({ version: reserved.data.version }),
    }, owner);

    // A direct member without manage_tracker_settings cannot start or finish the lifecycle…
    const editor = await provisionTrackerMember(owner, tracker.id, 'editor', 'Lifecycle Editor');
    expect((await trashTracker(editor, tracker.id)).status).toBe(403);

    // …while the owner trashes it and sees it in their own trash listing.
    const trashed = await trashTracker(owner, tracker.id);
    expect(trashed.status).toBe(200);
    const trashBody = (await trashed.json()) as JsonEnvelope<{
      id: string;
      deletedAt: string;
      deletionBatchId: string;
    }>;
    expect(trashBody.data.id).toBe(tracker.id);
    expect(trashBody.data.deletionBatchId).toBeTruthy();

    const listedTrash = await api<
      JsonEnvelope<Array<{ id: string; deletedAt: string; purgeAfter: string; canRestore: boolean }>>
    >('/api/v1/trackers/trash', 200, {}, owner);
    const entry = required(
      listedTrash.data.find((candidate) => candidate.id === tracker.id),
      'Trashed tracker is listed for its owner',
    );
    expect(new Date(entry.purgeAfter).getTime()).toBeGreaterThan(Date.now());
    expect(entry.canRestore).toBe(true);

    expect((await request(`/api/v1/trackers/${tracker.id}`, {}, owner)).status).toBe(404);
    expect((await purgeTrackerApi(editor, tracker.id)).status).toBe(403);
    const stranger = await provisionMember(owner);
    expect((await restoreTrackerApi(stranger, tracker.id)).status).toBe(404);

    // Restore brings every child back byte-for-byte reachable.
    expect((await restoreTrackerApi(owner, tracker.id)).status).toBe(201);
    const restoredRecords = await listTrackerRecords(owner, tracker.id);
    expect(restoredRecords.data.map((entry) => entry.title)).toEqual(['Lifecycle row']);
    const read = await api<JsonEnvelope<{ url: string }>>(
      `/api/v1/trackers/${tracker.id}/storage-objects/${reserved.data.id}/content`,
      200,
      {},
      owner,
    );
    expect((await fetch(read.data.url)).status).toBe(200);
    const trashAfterRestore = await api<JsonEnvelope<Array<{ id: string }>>>(
      '/api/v1/trackers/trash',
      200,
      {},
      owner,
    );
    expect(trashAfterRestore.data.some((candidate) => candidate.id === tracker.id)).toBe(false);

    // Second trash + purge hard-deletes everything and queues the blobs for reclamation.
    expect((await trashTracker(owner, tracker.id)).status).toBe(200);
    const purge = await purgeTrackerApi(owner, tracker.id);
    expect(purge.status).toBe(200);
    expect(((await purge.json()) as JsonEnvelope<{ purged: boolean }>).data.purged).toBe(true);

    expect((await request(`/api/v1/trackers/${tracker.id}`, {}, owner)).status).toBe(404);
    expect((await restoreTrackerApi(owner, tracker.id)).status).toBe(404);
    const afterPurge = await api<JsonEnvelope<Array<{ id: string }>>>(
      '/api/v1/trackers/trash',
      200,
      {},
      owner,
    );
    expect(afterPurge.data.some((candidate) => candidate.id === tracker.id)).toBe(false);

    if (databaseReachable()) {
      expect(
        queryDatabase(`SELECT count(*) FROM trackers WHERE id = '${tracker.id}'::uuid`),
      ).toBe('0');
      expect(
        queryDatabase(`SELECT count(*) FROM storage_objects WHERE tracker_id = '${tracker.id}'::uuid`),
      ).toBe('0');
      // Blob bytes are reclaimed by the outbox on its own schedule; the purge's contract is the
      // deduplicated deletion job naming the object keys (see `enqueueTrackerStoragePurge`).
      expect(
        queryDatabase(
          `SELECT count(*) FROM storage_deletion_jobs WHERE object_key LIKE '${tracker.id}/%'`,
        ),
      ).toBe('1');
    }
  }, 240_000);
});
