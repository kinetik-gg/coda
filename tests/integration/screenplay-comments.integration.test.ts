import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  acceptInvitation,
  api,
  ensureOwnerAuth,
  provisionMember,
  request,
  required,
  tokenFromInvitationUrl,
  uniqueEmail,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';

interface CommentView {
  id: string;
  authorUserId: string;
  body: string | null;
  deletedAt: string | null;
}

interface ThreadView {
  id: string;
  authorUserId: string;
  anchorStart: string;
  anchorEnd: string;
  quotedText: string;
  status: 'OPEN' | 'RESOLVED';
  comments: CommentView[];
}

function encodedAnchor(sourceText: string, start: number, end: number) {
  const document = new Y.Doc();
  const text = document.getText('source');
  text.insert(0, sourceText);
  const anchorStart = Buffer.from(
    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, start)),
  ).toString('base64');
  const anchorEnd = Buffer.from(
    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, end)),
  ).toString('base64');
  document.destroy();
  return { anchorStart, anchorEnd, quotedText: sourceText.slice(start, end) };
}

async function createScreenplay(auth: SessionAuth, sourceText: string) {
  return (
    await api<JsonEnvelope<{ id: string }>>(
      '/api/v1/screenplays',
      201,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Comment Threads', sourceText }),
      },
      auth,
    )
  ).data;
}

async function inviteViewer(owner: SessionAuth, screenplayId: string): Promise<SessionAuth> {
  const management = await api<JsonEnvelope<{ roles: Array<{ id: string; name: string }> }>>(
    `/api/v1/screenplays/${screenplayId}/management`,
    200,
    {},
    owner,
  );
  const viewer = required(
    management.data.roles.find((role) => role.name === 'viewer'),
    'seeded screenplay viewer role',
  );
  const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
    `/api/v1/screenplays/${screenplayId}/invitations`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        email: uniqueEmail('thread-viewer'),
        roleId: viewer.id,
      }),
    },
    owner,
  );
  return (
    await acceptInvitation(tokenFromInvitationUrl(invitation.data.invitationUrl), 'Thread Viewer')
  ).auth;
}

describe('Screenplay range-anchored comment threads', () => {
  let owner: SessionAuth;
  let stranger: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    stranger = await provisionMember(owner);
  }, 120_000);

  it('stores binary anchors without changing Fountain export bytes', async () => {
    const sourceText = 'INT. ROOM - DAY\r\n\r\nALICE\r\nA clean export.\r\n';
    const screenplay = await createScreenplay(owner, sourceText);
    const exportPath = `/api/v1/screenplays/${screenplay.id}/export.fountain`;
    const beforeResponse = await request(exportPath, {}, owner);
    expect(beforeResponse.status).toBe(200);
    const before = Buffer.from(await beforeResponse.arrayBuffer());
    const selectionStart = sourceText.indexOf('A clean export.');

    const created = await api<JsonEnvelope<ThreadView>>(
      `/api/v1/screenplays/${screenplay.id}/comment-threads`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          ...encodedAnchor(sourceText, selectionStart, selectionStart + 'A clean export.'.length),
          body: 'This note must remain out of every export.',
        }),
      },
      owner,
    );
    expect(created.data).toMatchObject({
      quotedText: 'A clean export.',
      status: 'OPEN',
      comments: [{ body: 'This note must remain out of every export.' }],
    });
    expect(Buffer.from(created.data.anchorStart, 'base64').byteLength).toBeGreaterThan(0);
    expect(Buffer.from(created.data.anchorEnd, 'base64').byteLength).toBeGreaterThan(0);

    const afterResponse = await request(exportPath, {}, owner);
    expect(afterResponse.status).toBe(200);
    const after = Buffer.from(await afterResponse.arrayBuffer());
    expect(after.equals(before)).toBe(true);
    expect(after.toString('utf8')).toBe(sourceText);
    expect(after.toString('utf8')).not.toContain('This note must remain out');

    expect(
      (await request(`/api/v1/screenplays/${screenplay.id}/comment-threads`, {}, stranger)).status,
    ).toBe(404);
  });

  it('lets viewers comment while enforcing author-aware resolution and deletion', async () => {
    const sourceText = 'INT. HALL - NIGHT\n\nA door opens.\n';
    const screenplay = await createScreenplay(owner, sourceText);
    const viewer = await inviteViewer(owner, screenplay.id);
    const start = sourceText.indexOf('A door opens.');
    const ownerThread = await api<JsonEnvelope<ThreadView>>(
      `/api/v1/screenplays/${screenplay.id}/comment-threads`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          ...encodedAnchor(sourceText, start, start + 'A door opens.'.length),
          body: 'Owner note',
        }),
      },
      owner,
    );

    expect(
      (
        await request(
          `/api/v1/screenplays/${screenplay.id}/comment-threads/${ownerThread.data.id}/resolution`,
          { method: 'PATCH', body: JSON.stringify({ resolved: true }) },
          viewer,
        )
      ).status,
    ).toBe(403);

    const viewerThread = await api<JsonEnvelope<ThreadView>>(
      `/api/v1/screenplays/${screenplay.id}/comment-threads`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          ...encodedAnchor(sourceText, start, start + 'A door opens.'.length),
          body: 'Viewer note',
        }),
      },
      viewer,
    );
    const reply = await api<JsonEnvelope<CommentView>>(
      `/api/v1/screenplays/${screenplay.id}/comment-threads/${viewerThread.data.id}/comments`,
      201,
      { method: 'POST', body: JSON.stringify({ body: 'Viewer reply' }) },
      viewer,
    );
    expect(reply.data.body).toBe('Viewer reply');

    const resolved = await api<JsonEnvelope<ThreadView>>(
      `/api/v1/screenplays/${screenplay.id}/comment-threads/${viewerThread.data.id}/resolution`,
      200,
      { method: 'PATCH', body: JSON.stringify({ resolved: true }) },
      viewer,
    );
    expect(resolved.data.status).toBe('RESOLVED');

    expect(
      (
        await request(
          `/api/v1/screenplays/${screenplay.id}/comments/${ownerThread.data.comments[0]!.id}`,
          { method: 'DELETE' },
          viewer,
        )
      ).status,
    ).toBe(403);
    const deleted = await api<JsonEnvelope<CommentView>>(
      `/api/v1/screenplays/${screenplay.id}/comments/${viewerThread.data.comments[0]!.id}`,
      200,
      { method: 'DELETE' },
      viewer,
    );
    expect(deleted.data).toMatchObject({ body: null });
    expect(deleted.data.deletedAt).toBeTruthy();
  }, 120_000);
});
