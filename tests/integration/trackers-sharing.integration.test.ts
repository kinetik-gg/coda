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
  bearerRequest,
  createTracker,
  createTrackerField,
  createTrackerRecord,
  mintTrackerCredential,
  provisionTrackerMember,
  setTrackerRecordValue,
  trashTracker,
  type TrackerCommentView,
  type TrackerRecordView,
} from './support/tracker-helpers';

/** A bare Space with the seeded role graph; trackers can be created straight into it. */
async function createSpace(owner: SessionAuth, label: string): Promise<{ id: string }> {
  const name = `Integration ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
  return (
    await api<JsonEnvelope<{ id: string }>>(
      '/api/v1/spaces',
      201,
      { method: 'POST', body: JSON.stringify({ name }) },
      owner,
    )
  ).data;
}

/**
 * S21 integration coverage, part two: who may touch a tracker. The authorization matrix
 * (direct owner/editor/viewer roles against Space-tier reach and strangers), tracker-bound
 * API credentials and the route allowlist they ride, and the record-comment permission rules.
 * The grid/layout/media/trash mechanics live in the sibling files.
 */

let owner: SessionAuth;

beforeAll(async () => {
  owner = await ensureOwnerAuth();
}, 120_000);

describe('tracker authorization matrix', () => {
  it('separates owner, direct editor, direct viewer, and stranger reach on one tracker', async () => {
    const tracker = await createTracker(owner, { name: 'Integration matrix tracker' });
    const editor = await provisionTrackerMember(owner, tracker.id, 'editor', 'Matrix Editor');
    const viewer = await provisionTrackerMember(owner, tracker.id, 'viewer', 'Matrix Viewer');
    const stranger = await provisionMember(owner);
    const field = await createTrackerField(owner, tracker.id, {
      name: 'Status',
      key: 'status',
      type: 'enum',
      options: [{ label: 'Open' }],
    });
    const record = await createTrackerRecord(owner, tracker.id, 'Shared record');

    // Owner: full vocabulary including management authorities.
    const ownerView = await api<JsonEnvelope<{ access: { permissions: string[] } }>>(
      `/api/v1/trackers/${tracker.id}`,
      200,
      {},
      owner,
    );
    expect(ownerView.data.access.permissions).toContain('manage_tracker_settings');

    // Editor: works records and fields, but never settings or deletion lifecycle.
    const editorView = await api<JsonEnvelope<{ access: { permissions: string[] } }>>(
      `/api/v1/trackers/${tracker.id}`,
      200,
      {},
      editor,
    );
    expect(editorView.data.access.permissions).toEqual([
      'read_tracker',
      'edit_tracker_records',
      'manage_tracker_fields',
    ]);
    await setTrackerRecordValue(
      editor, tracker.id, record.id, field.id,
      { type: 'enum', optionId: required(field.options[0], 'enum option').id }, record.version,
    );
    const editorRename = await request(`/api/v1/trackers/${tracker.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Editor rename', version: tracker.version }),
    }, editor);
    expect(editorRename.status).toBe(403);
    expect((await trashTracker(editor, tracker.id)).status).toBe(403);

    // Viewer: read-only everywhere; even a cell write is out of reach.
    const viewerView = await api<JsonEnvelope<{ access: { permissions: string[] } }>>(
      `/api/v1/trackers/${tracker.id}`,
      200,
      {},
      viewer,
    );
    expect(viewerView.data.access.permissions).toEqual(['read_tracker']);
    expect(
      (await request(`/api/v1/trackers/${tracker.id}/records`, {}, viewer)).status,
    ).toBe(200);
    const viewerWrite = await request(
      `/api/v1/trackers/${tracker.id}/records/${record.id}/fields/${field.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value: null, recordVersion: record.version }),
      },
      viewer,
    );
    expect(viewerWrite.status).toBe(403);

    // Stranger: tenant isolation — every route answers 404, never 403.
    for (const path of [
      `/api/v1/trackers/${tracker.id}`,
      `/api/v1/trackers/${tracker.id}/fields`,
      `/api/v1/trackers/${tracker.id}/records`,
      `/api/v1/trackers/${tracker.id}/activity`,
    ]) {
      expect((await request(path, {}, stranger)).status, path).toBe(404);
    }

    // Trash hides the tracker from members too (membership persists, visibility does not).
    expect((await trashTracker(owner, tracker.id)).status).toBe(200);
    expect((await request(`/api/v1/trackers/${tracker.id}`, {}, editor)).status).toBe(404);
    expect((await request(`/api/v1/trackers/${tracker.id}`, {}, viewer)).status).toBe(404);
  }, 180_000);

  it('projects Space-tier reach onto a tracker without any direct membership', async () => {
    const space = await createSpace(owner, 'tracker tier');
    const tracker = await createTracker(owner, {
      name: 'Integration space-tier tracker',
      spaceId: space.id,
    });
    const contributor = await provisionMember(owner);

    const session = await api<JsonEnvelope<{ id: string }>>('/api/v1/auth/session', 200, {}, contributor);
    const management = await api<JsonEnvelope<{ roles: Array<{ id: string; name: string }> }>>(
      `/api/v1/spaces/${space.id}/management`,
      200,
      {},
      owner,
    );
    const managerRole = required(
      management.data.roles.find((role) => role.name === 'manager'),
      'Space has a manager role',
    );
    await api(`/api/v1/spaces/${space.id}/memberships`, 201, {
      method: 'POST',
      body: JSON.stringify({ userId: session.data.id, roleId: managerRole.id }),
    }, owner);

    // A Space manager reads the tracker with exactly the cumulative tier grants…
    const view = await api<JsonEnvelope<{ access: { permissions: string[] } }>>(
      `/api/v1/trackers/${tracker.id}`,
      200,
      {},
      contributor,
    );
    expect(view.data.access.permissions).toEqual([
      'read_tracker',
      'comment_tracker',
      'edit_tracker_records',
      'manage_tracker_fields',
      'manage_tracker_settings',
    ]);

    // …and can even write cells through the tier…
    const field = await createTrackerField(owner, tracker.id, {
      name: 'Note',
      key: 'note',
      type: 'text',
    });
    const record = await createTrackerRecord(owner, tracker.id, 'Tiered record');
    const written = await setTrackerRecordValue(
      contributor, tracker.id, record.id, field.id,
      { type: 'text', value: 'From the Space tier' }, record.version,
    );
    expect(written.values[0]?.textValue).toBe('From the Space tier');

    // …but Space reach never reaches the destruction lifecycle: no membership row, no trash.
    expect((await trashTracker(contributor, tracker.id)).status).toBe(404);
  }, 180_000);
});

describe('tracker-bound credentials', () => {
  it('lets a bound credential work its tracker and nothing beyond the allowlist', async () => {
    const trackerA = await createTracker(owner, { name: 'Integration cred tracker A' });
    const trackerB = await createTracker(owner, { name: 'Integration cred tracker B' });
    const { id: credentialId, token } = await mintTrackerCredential(owner, trackerA.id, [
      'read_tracker',
      'edit_tracker_records',
    ]);

    const context = await bearerRequest('/api/v1/token/context', token);
    expect(context.status).toBe(200);
    const contextBody = (await context.json()) as {
      data: { resourceType: string; trackerId: string; kind: string; permissions: string[] };
    };
    expect(contextBody.data).toMatchObject({
      resourceType: 'tracker',
      trackerId: trackerA.id,
      kind: 'API_KEY',
      permissions: ['read_tracker', 'edit_tracker_records'],
    });

    expect((await bearerRequest(`/api/v1/trackers/${trackerA.id}`, token)).status).toBe(200);
    expect((await bearerRequest(`/api/v1/trackers/${trackerA.id}/records`, token)).status).toBe(200);
    const created = await bearerRequest(`/api/v1/trackers/${trackerA.id}/records`, token, {
      method: 'POST',
      body: JSON.stringify({ title: 'Written by a credential' }),
    });
    expect(created.status).toBe(201);
    const record = ((await created.json()) as JsonEnvelope<TrackerRecordView>).data;
    const patched = await bearerRequest(
      `/api/v1/trackers/${trackerA.id}/records/${record.id}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ title: 'Renamed by a credential', version: 1 }) },
    );
    expect(patched.status).toBe(200);

    // Session-only families refuse the credential before any membership lookup.
    expect(
      (await bearerRequest(`/api/v1/trackers/${trackerA.id}/management`, token)).status,
    ).toBe(403);
    expect(
      (await bearerRequest(`/api/v1/trackers/${trackerA.id}`, token, { method: 'DELETE' })).status,
    ).toBe(403);
    expect((await bearerRequest('/api/v1/trackers', token, {
      method: 'POST',
      body: JSON.stringify({ name: 'Credential cannot create' }),
    })).status).toBe(403);

    // A credential resolves exactly one resource: another tracker is invisible to it.
    expect((await bearerRequest(`/api/v1/trackers/${trackerB.id}`, token)).status).toBe(404);
    expect(
      (
        await bearerRequest(`/api/v1/trackers/${trackerB.id}/records`, token, {
          method: 'POST',
          body: JSON.stringify({ title: 'Wrong tracker' }),
        })
      ).status,
    ).toBe(404);

    // Revocation kills the token outright.
    await api(`/api/v1/account/credentials/${credentialId}`, 200, { method: 'DELETE' }, owner);
    expect((await bearerRequest(`/api/v1/trackers/${trackerA.id}`, token)).status).toBe(401);
  }, 180_000);

  it('keeps a read-only credential out of writes and project credentials out of trackers', async () => {
    const tracker = await createTracker(owner, { name: 'Integration cred scopes' });
    const { token: readOnly } = await mintTrackerCredential(
      owner,
      tracker.id,
      ['read_tracker'],
      'Readonly key',
    );
    const record = await createTrackerRecord(owner, tracker.id, 'Untouchable');
    const writeAttempt = await bearerRequest(
      `/api/v1/trackers/${tracker.id}/records/${record.id}`,
      readOnly,
      { method: 'PATCH', body: JSON.stringify({ title: 'Nope', version: 1 }) },
    );
    expect(writeAttempt.status).toBe(403);
    expect(JSON.stringify(await writeAttempt.json())).toContain('edit_tracker_records');

    const project = await api<JsonEnvelope<{ id: string }>>('/api/v1/projects/from-template', 201, {
      method: 'POST',
      body: JSON.stringify({ name: 'Cred scope project', templateId: 'movie' }),
    }, owner);
    const projectTokenResponse = await api<JsonEnvelope<{ token: string }>>(
      '/api/v1/account/credentials',
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          resourceType: 'project',
          projectId: project.data.id,
          name: 'Project key',
          kind: 'api_key',
          permissions: ['read_project'],
        }),
      },
      owner,
    );
    const projectToken = projectTokenResponse.data.token;
    expect(
      (await bearerRequest(`/api/v1/trackers/${tracker.id}`, projectToken)).status,
    ).toBe(403);
    expect(
      (await bearerRequest(`/api/v1/trackers/${tracker.id}/records`, projectToken)).status,
    ).toBe(403);
  }, 180_000);
});

describe('record comments permission rules', () => {
  let trackerId: string;
  let recordId: string;
  let editor: SessionAuth;
  let viewer: SessionAuth;
  let stranger: SessionAuth;

  beforeAll(async () => {
    const tracker = await createTracker(owner, { name: 'Integration comments tracker' });
    trackerId = tracker.id;
    const record = await createTrackerRecord(owner, tracker.id, 'Commented record');
    recordId = record.id;
    editor = await provisionTrackerMember(owner, tracker.id, 'editor', 'Comments Editor');
    viewer = await provisionTrackerMember(owner, tracker.id, 'viewer', 'Comments Viewer');
    stranger = await provisionMember(owner);
  }, 180_000);

  async function comments(auth: SessionAuth): Promise<Response> {
    return request(`/api/v1/trackers/${trackerId}/records/${recordId}/comments`, {}, auth);
  }

  it('lets readers list and commenters add comments', async () => {
    expect((await comments(stranger)).status).toBe(404);
    expect((await comments(viewer)).status).toBe(200);

    const ownerComment = await api<JsonEnvelope<TrackerCommentView>>(
      `/api/v1/trackers/${trackerId}/records/${recordId}/comments`,
      201,
      { method: 'POST', body: JSON.stringify({ body: 'Owner note' }) },
      owner,
    );
    await api<JsonEnvelope<TrackerCommentView>>(
      `/api/v1/trackers/${trackerId}/records/${recordId}/comments`,
      201,
      { method: 'POST', body: JSON.stringify({ body: 'Editor note' }) },
      editor,
    );
    expect(ownerComment.data.author.displayName).toBe('Integration Owner');

    // A direct viewer role holds neither edit_tracker_records nor comment_tracker.
    const viewerComment = await request(
      `/api/v1/trackers/${trackerId}/records/${recordId}/comments`,
      { method: 'POST', body: JSON.stringify({ body: 'Viewer note' }) },
      viewer,
    );
    expect(viewerComment.status).toBe(403);

    const feed = await comments(owner);
    const bodies = (((await feed.json()) as JsonEnvelope<TrackerCommentView[]>).data).map(
      (comment) => comment.body,
    );
    // The comment list reads oldest-first.
    expect(bodies).toEqual(['Owner note', 'Editor note']);
  }, 120_000);

  it('keeps edits and deletions author-only behind an optimistic version', async () => {
    const editorComment = await api<JsonEnvelope<TrackerCommentView>>(
      `/api/v1/trackers/${trackerId}/records/${recordId}/comments`,
      201,
      { method: 'POST', body: JSON.stringify({ body: 'Scratch this' }) },
      editor,
    );
    const commentId = editorComment.data.id;
    const commentPath = `/api/v1/trackers/${trackerId}/records/${recordId}/comments/${commentId}`;

    const foreignEdit = await request(commentPath, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Hijacked', version: editorComment.data.version }),
    }, owner);
    expect(foreignEdit.status).toBe(403);

    const staleEdit = await request(commentPath, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Stale', version: editorComment.data.version + 3 }),
    }, editor);
    expect(staleEdit.status).toBe(409);

    const edited = await api<JsonEnvelope<TrackerCommentView>>(commentPath, 200, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Edited by author', version: editorComment.data.version }),
    }, editor);
    expect(edited.data.body).toBe('Edited by author');
    expect(edited.data.editedAt).toBeTruthy();

    const foreignDelete = await request(commentPath, { method: 'DELETE' }, owner);
    expect(foreignDelete.status).toBe(403);
    expect((await request(commentPath, { method: 'DELETE' }, editor)).status).toBe(200);
    const remaining = ((await (await comments(owner)).json()) as JsonEnvelope<TrackerCommentView[]>)
      .data;
    expect(remaining.some((comment) => comment.id === commentId)).toBe(false);
  }, 120_000);
});
