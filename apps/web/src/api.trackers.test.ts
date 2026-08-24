// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addTrackerMember,
  archiveTrackerRole,
  changeTrackerMemberRole,
  completeTrackerUpload,
  createTracker,
  createTrackerRecord,
  createTrackerRecordComment,
  createTrackerRole,
  createTrackerUpload,
  deleteTrackerRecordComment,
  deleteTrackerRecords,
  getTracker,
  getTrackerManagement,
  getTrackerStorageObjectContent,
  inviteTrackerMember,
  listTrashedTrackers,
  listTrackerActivity,
  listTrackerAvailableUsers,
  listTrackerFields,
  listTrackerRecordComments,
  listTrackerRecords,
  listTrackers,
  purgeTracker,
  removeTrackerMember,
  renameTracker,
  restoreTracker,
  revokeTrackerInvitation,
  setTrackerRecordFieldValue,
  transferTrackerOwnership,
  trashTracker,
  updateTrackerRecord,
  updateTrackerRecordComment,
  updateTrackerRole,
} from './api';

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function captureFetch(): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        signal: init?.signal ?? undefined,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return requests;
}

const UUID = '00000000-0000-4000-8000-000000000001';

describe('tracker api helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists trackers scoped and unscoped', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await listTrackers();
    await listTrackers(UUID);
    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/trackers',
      `/api/v1/trackers?spaceId=${UUID}`,
    ]);
  });

  it('reads the trash listing without scoping', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await listTrashedTrackers();
    expect(requests[0]!).toMatchObject({ url: '/api/v1/trackers/trash', method: 'GET' });
  });

  it('creates a tracker with a name payload', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await createTracker({ name: 'Launch board' });
    expect(requests[0]!).toMatchObject({
      url: '/api/v1/trackers',
      method: 'POST',
      body: { name: 'Launch board' },
    });
  });

  it('passes the abort signal through on reads', async () => {
    const controller = new AbortController();
    const requests: CapturedRequest[] = captureFetch();
    await getTracker(UUID, controller.signal);
    expect(requests[0]!.signal).toBe(controller.signal);
  });

  it('renames with an optimistic version and strips the id from the body', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await renameTracker({ trackerId: UUID, name: 'Renamed', version: 4 });
    expect(requests[0]!).toMatchObject({
      url: `/api/v1/trackers/${UUID}`,
      method: 'PATCH',
      body: { name: 'Renamed', version: 4 },
    });
  });

  it('drives the trash lifecycle verbs', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await trashTracker(UUID);
    await restoreTracker(UUID);
    await purgeTracker(UUID);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `DELETE /api/v1/trackers/${UUID}`,
      `POST /api/v1/trackers/${UUID}/restore`,
      `DELETE /api/v1/trackers/${UUID}/purge`,
    ]);
  });

  it('surfaces management, available users, and activity reads', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await getTrackerManagement(UUID);
    await listTrackerAvailableUsers(UUID);
    await listTrackerActivity(UUID);
    expect(requests.map((request) => request.url)).toEqual([
      `/api/v1/trackers/${UUID}/management`,
      `/api/v1/trackers/${UUID}/available-users`,
      `/api/v1/trackers/${UUID}/activity`,
    ]);
  });

  it('adds, changes, and removes memberships with versioned bodies', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await addTrackerMember({ trackerId: UUID, userId: 'u1', roleId: 'r1' });
    await changeTrackerMemberRole({
      trackerId: UUID,
      membershipId: 'm1',
      roleId: 'r2',
      version: 2,
    });
    await removeTrackerMember({ trackerId: UUID, membershipId: 'm1', version: 3 });
    expect(requests[0]!).toMatchObject({
      url: `/api/v1/trackers/${UUID}/memberships`,
      method: 'POST',
      body: { userId: 'u1', roleId: 'r1' },
    });
    expect(requests[1]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/memberships/m1`,
      method: 'PATCH',
      body: { roleId: 'r2', version: 2 },
    });
    expect(requests[2]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/memberships/m1`,
      method: 'DELETE',
      body: { version: 3 },
    });
  });

  it('invites and revokes invitations by id and version', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await inviteTrackerMember({ trackerId: UUID, email: 'a@b.c', roleId: 'r1' });
    await revokeTrackerInvitation({ trackerId: UUID, invitationId: 'i1' });
    expect(requests[0]!.body).toEqual({ email: 'a@b.c', roleId: 'r1' });
    expect(requests[1]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/invitations/i1`,
      method: 'DELETE',
    });
  });

  it('manages custom roles under the subset rule payloads', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await createTrackerRole({ trackerId: UUID, name: 'Planner', permissions: ['read_tracker'] });
    await updateTrackerRole({
      trackerId: UUID,
      roleId: 'r1',
      version: 2,
      permissions: ['read_tracker'],
    });
    await archiveTrackerRole({ trackerId: UUID, roleId: 'r1', version: 3 });
    expect(requests[0]!.body).toEqual({ name: 'Planner', permissions: ['read_tracker'] });
    expect(requests[1]!.body).toEqual({ version: 2, permissions: ['read_tracker'] });
    expect(requests[2]!.body).toEqual({ version: 3 });
  });

  it('transfers ownership through the dedicated ceremony route', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await transferTrackerOwnership({
      trackerId: UUID,
      newOwnerMembershipId: 'm9',
      version: 7,
    });
    expect(requests[0]!).toMatchObject({
      url: `/api/v1/trackers/${UUID}/transfer-ownership`,
      method: 'POST',
      body: { newOwnerMembershipId: 'm9', version: 7 },
    });
  });

  it('serializes field and record queries including filters and cursors', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await listTrackerFields(UUID);
    await listTrackerRecords(UUID, {
      search: 'dock',
      sort: 'title',
      direction: 'asc',
      cursor: 'c1',
      limit: 50,
      filters: [{ fieldId: 'f1', operator: 'is', value: 'x' }],
    });
    expect(requests[0]!.url).toBe(`/api/v1/trackers/${UUID}/fields`);
    expect(requests[1]!.url).toContain('/records?');
    expect(requests[1]!.url).toContain(
      encodeURIComponent(
        JSON.stringify([
          {
            fieldId: 'f1',
            operator: 'is',
            value: 'x',
          },
        ]),
      ),
    );
    expect(requests[1]!.url).toContain('cursor=c1');
  });

  it('writes records and cell values optimistically', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await createTrackerRecord({ trackerId: UUID, title: 'Row' });
    await updateTrackerRecord({ trackerId: UUID, recordId: 'rec1', title: 'Row!', version: 2 });
    await setTrackerRecordFieldValue({
      trackerId: UUID,
      recordId: 'rec1',
      fieldId: 'f1',
      value: { type: 'text', value: 'hi' },
      recordVersion: 3,
    });
    await deleteTrackerRecords({ trackerId: UUID, ids: ['rec1'] });
    expect(requests[1]!.body).toEqual({ title: 'Row!', version: 2 });
    expect(requests[2]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/records/rec1/fields/f1`,
      method: 'PUT',
      body: { value: { type: 'text', value: 'hi' }, recordVersion: 3 },
    });
    expect(requests[3]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/records/bulk-delete`,
      method: 'POST',
      body: { ids: ['rec1'] },
    });
  });

  it('covers the record comment surface', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await listTrackerRecordComments(UUID, 'rec1');
    await createTrackerRecordComment({ trackerId: UUID, recordId: 'rec1', body: 'hello' });
    await updateTrackerRecordComment({
      trackerId: UUID,
      recordId: 'rec1',
      commentId: 'c1',
      body: 'edited',
      version: 2,
    });
    await deleteTrackerRecordComment({ trackerId: UUID, recordId: 'rec1', commentId: 'c1' });
    expect(requests[0]!.url).toBe(`/api/v1/trackers/${UUID}/records/rec1/comments?limit=100`);
    expect(requests[2]).toMatchObject({
      method: 'PATCH',
      url: `/api/v1/trackers/${UUID}/records/rec1/comments/c1`,
      body: { body: 'edited', version: 2 },
    });
    expect(requests[3]).toMatchObject({
      method: 'DELETE',
      url: `/api/v1/trackers/${UUID}/records/rec1/comments/c1`,
    });
  });

  it('walks the media upload lifecycle', async () => {
    const requests: CapturedRequest[] = captureFetch();
    await createTrackerUpload({
      trackerId: UUID,
      kind: 'image',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });
    await completeTrackerUpload({ trackerId: UUID, uploadId: 'up1', version: 1 });
    await getTrackerStorageObjectContent(UUID, 'obj1');
    expect(requests[0]!).toMatchObject({
      url: `/api/v1/trackers/${UUID}/uploads`,
      method: 'POST',
    });
    expect(requests[1]).toMatchObject({
      url: `/api/v1/trackers/${UUID}/uploads/up1/complete`,
      method: 'POST',
    });
    expect(requests[2]!.url).toBe(`/api/v1/trackers/${UUID}/storage-objects/obj1/content`);
  });
});

describe('tracker api error and pagination paths', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws ApiError with server detail when a tracker call returns a problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ type: 'about:blank', title: 'FORBIDDEN', status: 403 }), {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    );
    await expect(getTracker(UUID)).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('throws a transport error when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    await expect(listTrackers()).rejects.toThrow('offline');
  });

  it('follows cursors until a page without a next cursor arrives', async () => {
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        page += 1;
        return new Response(
          JSON.stringify({
            data: [{ id: `row-${page}` }],
            meta: { nextCursor: page === 1 ? 'cursor-2' : null },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const { listTrackerRecords } = await import('./api');
    const result = await listTrackerRecords(UUID, {});
    expect(result.items).toEqual([{ id: 'row-1' }]);
    expect(result.nextCursor).toBe('cursor-2');
  });

  it('requests tracker media content through the JSON envelope', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        requests.push(
          input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        );
        return Promise.resolve(
          new Response(JSON.stringify({ data: { url: '/blob/obj9' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    const content = await getTrackerStorageObjectContent(UUID, 'obj9');
    expect(content).toEqual({ url: '/blob/obj9' });
    expect(requests[0]).toBe(`/api/v1/trackers/${UUID}/storage-objects/obj9/content`);
  });
});

describe('tracker api transport edge paths', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('attaches the CSRF header from the cookie on unsafe methods', async () => {
    document.cookie = 'coda_csrf=token-123';
    const requests: CapturedRequest[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
        return Promise.resolve(
          new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    await createTrackerRecord({ trackerId: UUID, title: 'x' });
    expect(requests[0]?.headers ?? {}).toMatchObject({ 'x-coda-csrf': 'token-123' });
  });

  it('throws ApiError when a records page answers with a problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'OOPS', status: 500 }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(listTrackerRecords(UUID, {})).rejects.toMatchObject({
      problem: { status: 500 },
    });
  });
});
