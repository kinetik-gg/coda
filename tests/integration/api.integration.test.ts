import { beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvitation,
  api,
  createItem,
  createTextField,
  createViewerInvitation,
  ensureOwnerAuth,
  expectPrivateScreenplayResponse,
  listItems,
  memberPassword,
  onePagePdf,
  ownerEmail,
  ownerPassword,
  provisionExportFixture,
  provisionMember,
  provisionMovieProject,
  request,
  required,
  responseJson,
  setCachedOwnerAuth,
  setupToken,
  tokenFromInvitationUrl,
  uniqueEmail,
  authFrom,
  type Item,
  type JsonEnvelope,
  type Project,
  type SessionAuth,
} from './support/api-client';

describe('Instance setup and authentication', () => {
  it('bootstraps exactly one owner from a fresh instance and rejects invalid setup tokens', async () => {
    if (!setupToken || !ownerEmail || !ownerPassword) {
      throw new Error('Integration test credentials and setup token are required');
    }
    const token = setupToken;
    expect((await request('/api/v1/health/ready')).status).toBe(200);
    const status = await api<JsonEnvelope<{ initialized: boolean }>>('/api/v1/setup/status', 200);
    expect(status.data.initialized).toBe(false);

    const invalid = await request('/api/v1/setup/owner', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Integration Owner',
        email: ownerEmail,
        password: ownerPassword,
      }),
      headers: { 'x-coda-setup-token': 'wrong-token' },
    });
    expect(invalid.status).toBe(401);

    const createOwner = () =>
      request('/api/v1/setup/owner', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Integration Owner',
          email: ownerEmail,
          password: ownerPassword,
        }),
        headers: { 'x-coda-setup-token': token },
      });
    const attempts = await Promise.all([createOwner(), createOwner()]);
    expect(attempts.map(({ status: code }) => code).sort()).toEqual([201, 409]);
    const created = required(
      attempts.find(({ status: code }) => code === 201),
      'Expected exactly one successful setup request',
    );
    const auth = authFrom(created);
    setCachedOwnerAuth(auth);
    const session = await api<JsonEnvelope<{ email: string }>>(
      '/api/v1/auth/session',
      200,
      {},
      auth,
    );
    expect(session.data.email).toBe(ownerEmail);
  });
});

describe('Application shell and origin policy', () => {
  it('serves public application assets while rejecting disallowed API origins', async () => {
    const disallowedOrigin = 'https://untrusted.example.test';
    const shell = await request('/', { headers: { origin: disallowedOrigin } });
    expect(shell.status).toBe(200);
    const html = await shell.text();
    const assetPath = /src="([^"]+\.js)"/u.exec(html)?.[1];
    expect(assetPath).toBeTruthy();
    const asset = await request(required(assetPath, 'Application script was not found'), {
      headers: { origin: disallowedOrigin },
    });
    expect(asset.status).toBe(200);
    expect(
      (
        await request('/API/v1/setup/status', {
          headers: { origin: disallowedOrigin },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/v1/setup/status', {
          headers: { origin: disallowedOrigin },
          method: 'OPTIONS',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/v1/screenplays/import', {
          body: '{',
          headers: {
            cookie: `coda_session=${'a'.repeat(43)}`,
            'content-type': 'application/json',
            origin: disallowedOrigin,
          },
          method: 'POST',
        })
      ).status,
    ).toBe(403);
  });
});

describe('Breakdown items, fields, and concurrent reordering', () => {
  let owner: SessionAuth;
  let project: Project;
  let entityTypeId: string;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    project = await provisionMovieProject(owner);
    entityTypeId = required(project.entityTypes[0]?.id, 'Movie template has no root level');
  });

  it('creates the movie template level hierarchy', () => {
    expect(project.entityTypes.map(({ pluralName }) => pluralName)).toEqual([
      'Sequences',
      'Scenes',
      'Shots',
    ]);
  });

  it('rejects stale writes and applies manual reordering', async () => {
    const opening = await createItem(owner, project.id, entityTypeId, 'Opening sequence');
    const closing = await createItem(owner, project.id, entityTypeId, 'Closing sequence');

    const stale = await request(
      `/api/v1/projects/${project.id}/items/${opening.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Stale title', version: opening.version + 10 }),
      },
      owner,
    );
    expect(stale.status).toBe(409);

    await api<JsonEnvelope<Item>>(
      `/api/v1/projects/${project.id}/items/${closing.id}/reorder`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({ beforeId: opening.id, parentId: null, version: closing.version }),
      },
      owner,
    );
    const anchored = (await listItems(owner, project.id, entityTypeId))
      .map(({ id }) => id)
      .filter((id) => id === opening.id || id === closing.id);
    expect(anchored).toEqual([closing.id, opening.id]);
  });

  it('serialises concurrent reorders into a conflict-free total order', async () => {
    const opening = await createItem(owner, project.id, entityTypeId, 'Anchor opening');
    const closing = await createItem(owner, project.id, entityTypeId, 'Anchor closing');
    await api<JsonEnvelope<Item>>(
      `/api/v1/projects/${project.id}/items/${closing.id}/reorder`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({ beforeId: opening.id, parentId: null, version: closing.version }),
      },
      owner,
    );
    const moverA = await createItem(owner, project.id, entityTypeId, 'Concurrent mover A');
    const moverB = await createItem(owner, project.id, entityTypeId, 'Concurrent mover B');
    const moveIntoSameGap = (item: Item) =>
      request(
        `/api/v1/projects/${project.id}/items/${item.id}/reorder`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            afterId: closing.id,
            beforeId: opening.id,
            parentId: null,
            version: item.version,
          }),
        },
        owner,
      );
    const concurrent = await Promise.all([moveIntoSameGap(moverA), moveIntoSameGap(moverB)]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 400]);

    const reordered = await listItems(owner, project.id, entityTypeId);
    const anchorIds = [opening.id, closing.id, moverA.id, moverB.id];
    const relevant = reordered.filter(({ id }) => anchorIds.includes(id));
    expect(new Set(reordered.map(({ position }) => position)).size).toBe(reordered.length);
    expect(relevant[0]?.id).toBe(closing.id);
    expect([moverA.id, moverB.id]).toContain(relevant[1]?.id);
    expect(relevant[2]?.id).toBe(opening.id);
  });

  it('persists text field values on items', async () => {
    const item = await createItem(owner, project.id, entityTypeId, 'Annotated sequence');
    const fieldId = await createTextField(owner, project.id, entityTypeId);
    await api<JsonEnvelope<Item>>(
      `/api/v1/projects/${project.id}/items/${item.id}/fields/${fieldId}`,
      200,
      {
        method: 'PUT',
        body: JSON.stringify({
          value: { type: 'text', value: 'Hold on the final frame' },
          itemVersion: item.version,
        }),
      },
      owner,
    );
    const persisted = required(
      (await listItems(owner, project.id, entityTypeId)).find(({ id }) => id === item.id),
      'Annotated item disappeared after field update',
    );
    expect(persisted.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId, textValue: 'Hold on the final frame' }),
      ]),
    );
  });
});

describe('Storage uploads, source references, and exports', () => {
  let owner: SessionAuth;
  let project: Project;
  let entityTypeId: string;
  let itemId: string;
  let fieldId: string;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    ({ project, entityTypeId, itemId, fieldId } = await provisionExportFixture(owner));
  });

  it('stores uploads idempotently, links references, and exports CSV and project JSON', async () => {
    const pdf = onePagePdf();
    const upload = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
      '/api/v1/uploads',
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          kind: 'source_document',
          filename: 'integration-source.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
        }),
      },
      owner,
    );
    const uploadHeaders = { 'content-type': 'application/pdf', 'if-none-match': '*' };
    const firstPut = await fetch(upload.data.uploadUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: Uint8Array.from(pdf).buffer,
    });
    expect(firstPut.status).toBe(200);
    const replayPut = await fetch(upload.data.uploadUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: Uint8Array.from(pdf).buffer,
    });
    expect([409, 412]).toContain(replayPut.status);

    const completed = await api<JsonEnvelope<{ id: string; status: string }>>(
      `/api/v1/projects/${project.id}/uploads/${upload.data.id}/complete`,
      201,
      { method: 'POST', body: JSON.stringify({ version: upload.data.version }) },
      owner,
    );
    expect(completed.data.status).toBe('READY');
    const signedRead = await api<JsonEnvelope<{ url: string; expiresIn: number }>>(
      `/api/v1/projects/${project.id}/storage-objects/${upload.data.id}/content`,
      200,
      {},
      owner,
    );
    expect(signedRead.data.expiresIn).toBeGreaterThan(0);
    const downloaded = await fetch(signedRead.data.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(Buffer.from(pdf));
    const document = await api<JsonEnvelope<{ id: string; pageCount: number }>>(
      `/api/v1/projects/${project.id}/source-documents`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({ storageObjectId: upload.data.id, title: 'Integration source' }),
      },
      owner,
    );
    expect(document.data.pageCount).toBe(1);
    await api<JsonEnvelope<{ id: string }>>(
      `/api/v1/projects/${project.id}/items/${itemId}/source-references`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({ sourceDocumentId: document.data.id, startPage: 1, endPage: 1 }),
      },
      owner,
    );
    const referenced = required(
      (await listItems(owner, project.id, entityTypeId)).find(({ id }) => id === itemId),
      'Referenced item was not returned',
    );
    expect(referenced.sourceReferences).toEqual([
      expect.objectContaining({ sourceDocumentId: document.data.id, startPage: 1, endPage: 1 }),
    ]);

    const csv = await request(
      `/api/v1/projects/${project.id}/exports/levels/${entityTypeId}.csv`,
      {},
      owner,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const csvText = await csv.text();
    expect(csvText).toContain('Editorial note');
    expect(csvText).toContain('Hold on the final frame');

    const exported = await request(
      `/api/v1/projects/${project.id}/exports/project.json`,
      {},
      owner,
    );
    expect(exported.status).toBe(200);
    const projectExport = (await exported.json()) as {
      schemaVersion: number;
      project: { id: string; items: Item[]; fields: Array<{ id: string }> };
    };
    expect(projectExport.schemaVersion).toBe(1);
    expect(projectExport.project.id).toBe(project.id);
    expect(projectExport.project.fields.map(({ id }) => id)).toContain(fieldId);
    expect(
      projectExport.project.items.find(({ id }) => id === itemId)?.sourceReferences,
    ).toHaveLength(1);
  });
});

describe('Project invitations and tenant isolation', () => {
  let owner: SessionAuth;
  let sharedProject: Project;
  const memberEmail = uniqueEmail('integration-member');

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    sharedProject = await provisionMovieProject(owner);
  });

  it('accepts an invitation, consumes its token, and grants shared-project access', async () => {
    const viewer = required(
      sharedProject.roles.find(({ name, isOwner }) => name === 'viewer' && !isOwner),
      'Project has no viewer role',
    );
    const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
      `/api/v1/projects/${sharedProject.id}/invitations`,
      201,
      { method: 'POST', body: JSON.stringify({ email: memberEmail, roleId: viewer.id }) },
      owner,
    );
    const token = tokenFromInvitationUrl(invitation.data.invitationUrl);
    const described = await api<JsonEnvelope<{ kind: string; email: string }>>(
      `/api/v1/invitations/${encodeURIComponent(token)}`,
      200,
    );
    expect(described.data).toMatchObject({ kind: 'project', email: memberEmail });
    const member = await acceptInvitation(token, 'Integration Member');
    expect(member.email).toBe(memberEmail);
    expect((await request(`/api/v1/invitations/${encodeURIComponent(token)}`)).status).toBe(404);
    expect((await request(`/api/v1/projects/${sharedProject.id}`, {}, member.auth)).status).toBe(
      200,
    );
  });

  it('isolates tenants and enforces the trash, restore, and purge lifecycle', async () => {
    const member = await provisionMember(owner);
    const isolatedCreated = await api<JsonEnvelope<{ id: string }>>(
      '/api/v1/projects',
      201,
      { method: 'POST', body: JSON.stringify({ name: 'Isolated disposable project' }) },
      owner,
    );
    const isolated = (
      await api<JsonEnvelope<Project>>(
        `/api/v1/projects/${isolatedCreated.data.id}`,
        200,
        {},
        owner,
      )
    ).data;
    expect((await request(`/api/v1/projects/${isolated.id}`, {}, member)).status).toBe(404);

    const revokedToken = await createViewerInvitation(
      owner,
      isolated,
      uniqueEmail('revoked-integration-member'),
    );
    expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
      200,
    );
    await api<JsonEnvelope<{ deletedAt: string }>>(
      `/api/v1/projects/${isolated.id}/trash`,
      200,
      { method: 'DELETE' },
      owner,
    );
    expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
      404,
    );
    expect(
      (
        await request('/api/v1/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({
            token: revokedToken,
            displayName: 'Must Not Exist',
            password: 'IntegrationMember2026',
          }),
        })
      ).status,
    ).toBe(404);
    const trash = await api<JsonEnvelope<Array<{ id: string }>>>(
      '/api/v1/projects/trash',
      200,
      {},
      owner,
    );
    expect(trash.data.map(({ id }) => id)).toContain(isolated.id);

    await api<JsonEnvelope<{ id: string }>>(
      `/api/v1/projects/${isolated.id}/restore`,
      201,
      { method: 'POST' },
      owner,
    );
    expect((await request(`/api/v1/projects/${isolated.id}`, {}, owner)).status).toBe(200);
    expect((await request(`/api/v1/invitations/${encodeURIComponent(revokedToken)}`)).status).toBe(
      404,
    );
    await api<JsonEnvelope<{ id: string }>>(
      `/api/v1/projects/${isolated.id}/trash`,
      200,
      { method: 'DELETE' },
      owner,
    );
    await api<JsonEnvelope<{ purged: boolean }>>(
      `/api/v1/projects/${isolated.id}/purge`,
      200,
      { method: 'DELETE' },
      owner,
    );
    expect((await request(`/api/v1/projects/${isolated.id}`, {}, owner)).status).toBe(404);
  });
});

describe('Credential scopes', () => {
  let owner: SessionAuth;
  let projectId: string;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    projectId = (await provisionMovieProject(owner)).id;
  });

  it('mints scoped credentials that cannot escape their project or reach account routes', async () => {
    const credential = await api<JsonEnvelope<{ token: string }>>(
      '/api/v1/account/credentials',
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          name: 'Integration API key',
          kind: 'api_key',
          permissions: ['read_project'],
        }),
      },
      owner,
    );
    const bearer = { authorization: `Bearer ${credential.data.token}` };
    const context = await api<JsonEnvelope<{ projectId: string }>>('/api/v1/token/context', 200, {
      headers: bearer,
    });
    expect(context.data.projectId).toBe(projectId);
    expect((await request('/api/v1/account', { headers: bearer })).status).toBe(403);
    expect(
      (
        await request('/api/v1/projects/90000000-0000-4000-8000-000000000009/items', {
          headers: bearer,
        })
      ).status,
    ).toBe(404);
  });
});

describe('Screenplays and checkpoints', () => {
  let owner: SessionAuth;
  let other: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    other = await provisionMember(owner);
  });

  it('versions screenplays, snapshots checkpoints, and isolates them per author', async () => {
    const createResponse = await request(
      '/api/v1/screenplays',
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Integration Draft',
          sourceText: 'Title: Integration Draft\n',
        }),
      },
      owner,
    );
    expectPrivateScreenplayResponse(createResponse);
    const created = await responseJson<JsonEnvelope<{ id: string; version: number }>>(
      createResponse,
      201,
    );

    const listResponse = await request('/api/v1/screenplays?limit=1', {}, owner);
    expectPrivateScreenplayResponse(listResponse);
    const list = await responseJson<JsonEnvelope<Array<{ id: string }>>>(listResponse, 200);
    expect(list.data.length).toBeLessThanOrEqual(1);

    const getResponse = await request(`/api/v1/screenplays/${created.data.id}`, {}, owner);
    expectPrivateScreenplayResponse(getResponse);
    await responseJson(getResponse, 200);

    const checkpointSource = '﻿Title: Integration Draft\r\n\r\nINT. CAFÉ - DAY\r\n';
    const updateResponse = await request(
      `/api/v1/screenplays/${created.data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: created.data.version,
          sourceText: checkpointSource,
          paperSize: 'a4',
        }),
      },
      owner,
    );
    expectPrivateScreenplayResponse(updateResponse);
    const updated = await responseJson<JsonEnvelope<{ version: number }>>(updateResponse, 200);

    const checkpointResponse = await request(
      `/api/v1/screenplays/${created.data.id}/checkpoints`,
      { method: 'POST', body: JSON.stringify({ version: updated.data.version }) },
      owner,
    );
    expectPrivateScreenplayResponse(checkpointResponse);
    const checkpoint = await responseJson<
      JsonEnvelope<{ id: string; screenplayVersion: number; paperSize: 'letter' | 'a4' }>
    >(checkpointResponse, 201);
    expect(checkpoint.data.screenplayVersion).toBe(updated.data.version);
    expect(checkpoint.data.paperSize).toBe('a4');

    const repeatedCheckpoint = await api<JsonEnvelope<{ id: string; paperSize: string }>>(
      `/api/v1/screenplays/${created.data.id}/checkpoints`,
      201,
      { method: 'POST', body: JSON.stringify({ version: updated.data.version }) },
      owner,
    );
    expect(repeatedCheckpoint.data.id).toBe(checkpoint.data.id);
    expect(repeatedCheckpoint.data.paperSize).toBe('a4');

    const isolatedCheckpoint = await request(
      `/api/v1/screenplays/${created.data.id}/checkpoints`,
      { method: 'POST', body: JSON.stringify({ version: updated.data.version }) },
      other,
    );
    expect(isolatedCheckpoint.status).toBe(404);

    const staleCheckpoint = await request(
      `/api/v1/screenplays/${created.data.id}/checkpoints`,
      { method: 'POST', body: JSON.stringify({ version: created.data.version }) },
      owner,
    );
    expect(staleCheckpoint.status).toBe(409);

    const currentSource = 'Title: Integration Draft\n\nEXT. CHANGED - NIGHT\n';
    await api(
      `/api/v1/screenplays/${created.data.id}`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: updated.data.version,
          sourceText: currentSource,
          paperSize: 'letter',
        }),
      },
      owner,
    );

    const checkpointExport = await request(
      `/api/v1/screenplays/${created.data.id}/checkpoints/${checkpoint.data.id}/export.fountain`,
      {},
      owner,
    );
    expectPrivateScreenplayResponse(checkpointExport);
    expect(checkpointExport.status).toBe(200);
    expect(Buffer.from(await checkpointExport.arrayBuffer())).toEqual(
      Buffer.from(checkpointSource, 'utf8'),
    );

    const isolatedExport = await request(
      `/api/v1/screenplays/${created.data.id}/checkpoints/${checkpoint.data.id}/export.fountain`,
      {},
      other,
    );
    expect(isolatedExport.status).toBe(404);

    const exportResponse = await request(
      `/api/v1/screenplays/${created.data.id}/export.fountain`,
      {},
      owner,
    );
    expectPrivateScreenplayResponse(exportResponse);
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.text()).toBe(currentSource);

    const importResponse = await request(
      '/api/v1/screenplays/import',
      {
        method: 'POST',
        body: JSON.stringify({ filename: 'integration.fountain', sourceText: 'Title: Imported\n' }),
      },
      owner,
    );
    expectPrivateScreenplayResponse(importResponse);
    await responseJson(importResponse, 201);
  });
});

describe('Account-scoped login backoff and recovery', () => {
  let owner: SessionAuth;
  // The server is configured with this threshold (see the AUTH_LOGIN_BACKOFF_THRESHOLD env var). The
  // scenario spends `threshold + 2` login requests (failures, one correct-but-locked attempt, and one
  // recovered attempt), which must stay within the per-IP login throttle of 5/60s, so it only runs
  // when configured with a threshold of at most 3.
  const threshold = Number(process.env.AUTH_LOGIN_BACKOFF_THRESHOLD ?? '5');

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
  });

  it.runIf(threshold + 2 <= 5)(
    'locks an account after consecutive failures and restores it through a password reset',
    async () => {
      // Provision a dedicated victim account so the shared owner login is never locked.
      const project = await provisionMovieProject(owner);
      const email = uniqueEmail('integration-lockout');
      const token = await createViewerInvitation(owner, project, email);
      const accepted = await api<JsonEnvelope<{ id: string; email: string }>>(
        '/api/v1/invitations/accept',
        201,
        {
          method: 'POST',
          body: JSON.stringify({ token, displayName: 'Lockout Victim', password: memberPassword }),
        },
      );
      const userId = accepted.data.id;
      const wrongPassword = `not-${memberPassword}`;

      // Drive the account past its failed-attempt threshold. Every rejection is an identical 401 with
      // no account-existence or lock-state signal.
      for (let attempt = 0; attempt < threshold; attempt += 1) {
        const failed = await request('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: wrongPassword }),
        });
        expect(failed.status).toBe(401);
      }

      // The account is now locked: even the correct password is rejected, with the same 401 shape.
      const lockedResponse = await request('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: memberPassword }),
      });
      expect(lockedResponse.status).toBe(401);

      // Recover through an administrator-issued reset link, which clears the counter and the lock.
      const resetLink = await api<JsonEnvelope<{ resetUrl: string }>>(
        `/api/v1/users/${userId}/reset-links`,
        201,
        { method: 'POST' },
        owner,
      );
      const resetToken = tokenFromInvitationUrl(resetLink.data.resetUrl);
      const newPassword = 'RecoveredPassword2026';
      await api<JsonEnvelope<{ reset: boolean }>>('/api/v1/auth/reset-password', 201, {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });

      // Access is restored immediately: the lock and counter were reset by the completed recovery.
      const recovered = await request('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: newPassword }),
      });
      await responseJson(recovered, 200);
    },
  );
});
