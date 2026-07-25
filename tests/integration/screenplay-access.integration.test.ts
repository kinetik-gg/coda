import { beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvitation,
  api,
  ensureOwnerAuth,
  memberPassword,
  provisionMember,
  request,
  required,
  tokenFromInvitationUrl,
  uniqueEmail,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';

describe('Screenplay access control', () => {
  type Role = { id: string; name: string; isOwner: boolean };
  type Membership = {
    id: string;
    role: { id: string; name: string; isOwner: boolean };
    user: { id: string; email: string };
  };
  type Management = { version: number; roles: Role[]; memberships: Membership[] };

  let owner: SessionAuth;
  let stranger: SessionAuth;

  // Generous hook budget: this file re-authenticates the owner, which may sit out the 60s login
  // throttle spent by the account-lockout scenario (see loginWithThrottlePatience).
  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    stranger = await provisionMember(owner);
  }, 120_000);

  async function invite(targetScreenplayId: string, roleId: string, prefix: string) {
    const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
      `/api/v1/screenplays/${targetScreenplayId}/invitations`,
      201,
      { method: 'POST', body: JSON.stringify({ email: uniqueEmail(prefix), roleId }) },
      owner,
    );
    return {
      url: invitation.data.invitationUrl,
      accepted: await acceptInvitation(
        tokenFromInvitationUrl(invitation.data.invitationUrl),
        prefix,
      ),
    };
  }

  let screenplayId: string;

  it('shares a screenplay by role, isolates non-members, and enforces the role matrix', async () => {
    const created = await api<JsonEnvelope<{ id: string; version: number }>>(
      '/api/v1/screenplays',
      201,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Shared Draft', sourceText: 'Title: Shared Draft\n' }),
      },
      owner,
    );
    screenplayId = created.data.id;

    // Tenant isolation: a non-member cannot observe the screenplay or its management surface (404,
    // never 403 — the resource must not be revealed to exist).
    expect((await request(`/api/v1/screenplays/${screenplayId}`, {}, stranger)).status).toBe(404);
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}/management`, {}, stranger)).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/v1/screenplays/${screenplayId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ version: created.data.version, title: 'Hijack' }),
          },
          stranger,
        )
      ).status,
    ).toBe(404);

    const mgmt = await api<JsonEnvelope<Management>>(
      `/api/v1/screenplays/${screenplayId}/management`,
      200,
      {},
      owner,
    );
    const viewerRole = required(
      mgmt.data.roles.find((role) => role.name === 'viewer'),
      'seeded viewer role',
    );
    const editorRole = required(
      mgmt.data.roles.find((role) => role.name === 'editor'),
      'seeded editor role',
    );

    // A viewer sees exactly what the role permits: read yes, write/manage no (403 — a member whose
    // role lacks the permission).
    const viewer = (await invite(screenplayId, viewerRole.id, 'sp-viewer')).accepted;
    const viewerDetail = await api<JsonEnvelope<{ version: number }>>(
      `/api/v1/screenplays/${screenplayId}`,
      200,
      {},
      viewer.auth,
    );
    expect(
      (
        await request(
          `/api/v1/screenplays/${screenplayId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ version: viewerDetail.data.version, title: 'Nope' }),
          },
          viewer.auth,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/v1/screenplays/${screenplayId}/invitations`,
          {
            method: 'POST',
            body: JSON.stringify({ email: uniqueEmail('x'), roleId: viewerRole.id }),
          },
          viewer.auth,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}/management`, {}, viewer.auth)).status,
    ).toBe(403);

    // Per-user panel layout (#142): a member may read/write their OWN row; a non-member is 404.
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}/panel-layout`, {}, stranger)).status,
    ).toBe(404);
    const emptyLayout = await api<JsonEnvelope<{ revision: number } | null>>(
      `/api/v1/screenplays/${screenplayId}/panel-layout`,
      200,
      {},
      viewer.auth,
    );
    expect(emptyLayout.data).toBeNull();
    const savedLayout = await api<JsonEnvelope<{ revision: number }>>(
      `/api/v1/screenplays/${screenplayId}/panel-layout`,
      200,
      {
        method: 'PUT',
        body: JSON.stringify({
          layout: { schemaVersion: 1, root: { kind: 'panel' } },
          expectedRevision: 0,
        }),
      },
      viewer.auth,
    );
    // First save lazily creates the row at revision 0 (create does not increment).
    expect(savedLayout.data.revision).toBe(0);
    const reloaded = await api<JsonEnvelope<{ revision: number } | null>>(
      `/api/v1/screenplays/${screenplayId}/panel-layout`,
      200,
      {},
      viewer.auth,
    );
    expect(reloaded.data?.revision).toBe(0);

    // Trash lifecycle (#148) guards: a read-only member cannot trash (403); a non-member cannot
    // observe the trash surface at all (404). Neither mutates state.
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}`, { method: 'DELETE' }, viewer.auth))
        .status,
    ).toBe(403);
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}`, { method: 'DELETE' }, stranger)).status,
    ).toBe(404);
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}/restore`, { method: 'POST' }, stranger))
        .status,
    ).toBe(404);

    // An editor can write but still cannot manage members.
    const editorInvitation = await invite(screenplayId, editorRole.id, 'sp-editor');
    const editor = editorInvitation.accepted;
    const editorDetail = await api<JsonEnvelope<{ version: number }>>(
      `/api/v1/screenplays/${screenplayId}`,
      200,
      {},
      editor.auth,
    );
    await api(
      `/api/v1/screenplays/${screenplayId}`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({
          version: editorDetail.data.version,
          sourceText: 'Title: Shared Draft\n\nINT. HOUSE - DAY\n',
        }),
      },
      editor.auth,
    );
    expect(
      (await request(`/api/v1/screenplays/${screenplayId}/management`, {}, editor.auth)).status,
    ).toBe(403);

    // Invitation lifecycle: a consumed token cannot be redeemed a second time.
    const reuse = await request('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({
        token: tokenFromInvitationUrl(editorInvitation.url),
        displayName: 'Duplicate',
        password: memberPassword,
      }),
    });
    expect(reuse.status).toBe(404);

    // Ownership transfer moves the owner-role membership; the new owner can manage and the previous
    // owner can no longer transfer.
    const beforeTransfer = await api<JsonEnvelope<Management>>(
      `/api/v1/screenplays/${screenplayId}/management`,
      200,
      {},
      owner,
    );
    const editorMembership = required(
      beforeTransfer.data.memberships.find((member) => member.user.email === editor.email),
      'editor membership',
    );
    await api(
      `/api/v1/screenplays/${screenplayId}/transfer-ownership`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          newOwnerMembershipId: editorMembership.id,
          version: beforeTransfer.data.version,
        }),
      },
      owner,
    );
    const afterTransfer = await api<JsonEnvelope<Management>>(
      `/api/v1/screenplays/${screenplayId}/management`,
      200,
      {},
      editor.auth,
    );
    const ownerNow = required(
      afterTransfer.data.memberships.find((member) => member.role.isOwner),
      'owner membership after transfer',
    );
    expect(ownerNow.user.email).toBe(editor.email);
    const demotedTransfer = await request(
      `/api/v1/screenplays/${screenplayId}/transfer-ownership`,
      {
        method: 'POST',
        body: JSON.stringify({
          newOwnerMembershipId: editorMembership.id,
          version: afterTransfer.data.version,
        }),
      },
      owner,
    );
    expect(demotedTransfer.status).toBe(409);
  });

  it('trashes a shared screenplay: members lose normal access, the owner restores it', async () => {
    const created = await api<JsonEnvelope<{ id: string }>>(
      '/api/v1/screenplays',
      201,
      { method: 'POST', body: JSON.stringify({ title: 'Trash Draft', sourceText: 'Title: T\n' }) },
      owner,
    );
    const id = created.data.id;
    const mgmt = await api<JsonEnvelope<Management>>(
      `/api/v1/screenplays/${id}/management`,
      200,
      {},
      owner,
    );
    const viewerRole = required(
      mgmt.data.roles.find((role) => role.name === 'viewer'),
      'seeded viewer role',
    );
    const member = (await invite(id, viewerRole.id, 'sp-trash-viewer')).accepted;
    // Sanity: the member can read the live screenplay.
    expect((await request(`/api/v1/screenplays/${id}`, {}, member.auth)).status).toBe(200);

    // Owner trashes it.
    await api(`/api/v1/screenplays/${id}`, 200, { method: 'DELETE' }, owner);

    // Normal endpoints now 404 for members (get + per-user panel layout); the trashed doc is hidden.
    expect((await request(`/api/v1/screenplays/${id}`, {}, member.auth)).status).toBe(404);
    expect((await request(`/api/v1/screenplays/${id}/panel-layout`, {}, member.auth)).status).toBe(
      404,
    );
    expect((await request(`/api/v1/screenplays/${id}`, {}, owner)).status).toBe(404);
    // A read-only member still cannot restore or purge (403); the owner can.
    expect(
      (await request(`/api/v1/screenplays/${id}/restore`, { method: 'POST' }, member.auth)).status,
    ).toBe(403);
    const trashList = await api<JsonEnvelope<Array<{ id: string }>>>(
      '/api/v1/screenplays/trash',
      200,
      {},
      owner,
    );
    expect(trashList.data.some((row) => row.id === id)).toBe(true);

    // Owner restores; normal access returns for members.
    await api(`/api/v1/screenplays/${id}/restore`, 201, { method: 'POST' }, owner);
    expect((await request(`/api/v1/screenplays/${id}`, {}, member.auth)).status).toBe(200);
  });
});
