import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  ensureOwnerAuth,
  personalDefaultSpace,
  provisionMember,
  request,
  required,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';

type Space = { id: string };
type SpaceRole = { id: string; name: string };
type SpaceManagement = { roles: SpaceRole[] };
type UserSession = { id: string };
type Created = { id: string };

function uniqueName(label: string): string {
  return `Integration ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
}

async function createSpace(owner: SessionAuth, label: string): Promise<Space> {
  const result = await api<JsonEnvelope<Space>>(
    '/api/v1/spaces',
    201,
    { method: 'POST', body: JSON.stringify({ name: uniqueName(label) }) },
    owner,
  );
  return result.data;
}

async function addSpaceMember(
  owner: SessionAuth,
  spaceId: string,
  roleName: string,
  member: SessionAuth,
): Promise<void> {
  const management = await api<JsonEnvelope<SpaceManagement>>(
    `/api/v1/spaces/${spaceId}/management`,
    200,
    {},
    owner,
  );
  const role = required(
    management.data.roles.find((entry) => entry.name === roleName),
    `Missing ${roleName} role`,
  );
  const session = await api<JsonEnvelope<UserSession>>('/api/v1/auth/session', 200, {}, member);
  await api(
    `/api/v1/spaces/${spaceId}/memberships`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({ userId: session.data.id, roleId: role.id }),
    },
    owner,
  );
}

function screenplayBody(spaceId?: string): string {
  const title = uniqueName('screenplay');
  return JSON.stringify({
    title,
    sourceText: `Title: ${title}\n`,
    ...(spaceId ? { spaceId } : {}),
  });
}

function breakdownBody(spaceId?: string): string {
  return JSON.stringify({ name: uniqueName('breakdown'), ...(spaceId ? { spaceId } : {}) });
}

async function screenplayIds(auth: SessionAuth, spaceId?: string): Promise<string[]> {
  const suffix = spaceId ? `?spaceId=${spaceId}` : '';
  const result = await api<JsonEnvelope<Created[]>>(`/api/v1/screenplays${suffix}`, 200, {}, auth);
  return result.data.map((entry) => entry.id);
}

async function breakdownIds(auth: SessionAuth, spaceId?: string): Promise<string[]> {
  const suffix = spaceId ? `?spaceId=${spaceId}` : '';
  const result = await api<JsonEnvelope<Created[]>>(`/api/v1/projects${suffix}`, 200, {}, auth);
  return result.data.map((entry) => entry.id);
}

describe('create_resources enforcement through the application stack', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
  }, 120_000);

  it('lets a Space contributor create a screenplay in that Space and lands it there', async () => {
    const space = await createSpace(owner, 'screenplay create allowed');
    const contributor = await provisionMember(owner);
    await addSpaceMember(owner, space.id, 'contributor', contributor);
    const contributorDefault = await personalDefaultSpace(contributor);

    const created = await api<JsonEnvelope<Created>>(
      '/api/v1/screenplays',
      201,
      { method: 'POST', body: screenplayBody(space.id) },
      contributor,
    );

    expect(await screenplayIds(contributor, space.id)).toContain(created.data.id);
    expect(await screenplayIds(contributor, contributorDefault.id)).not.toContain(created.data.id);
  }, 120_000);

  it('refuses a screenplay in a Space whose role withholds create_resources', async () => {
    const space = await createSpace(owner, 'screenplay create refused');
    const viewer = await provisionMember(owner);
    await addSpaceMember(owner, space.id, 'viewer', viewer);

    const response = await request(
      '/api/v1/screenplays',
      { method: 'POST', body: screenplayBody(space.id) },
      viewer,
    );

    expect(response.status).toBe(403);
    expect(await screenplayIds(viewer, space.id)).toEqual([]);
  }, 120_000);

  it('lets a Space contributor create a breakdown in that Space and lands it there', async () => {
    const space = await createSpace(owner, 'breakdown create allowed');
    const contributor = await provisionMember(owner);
    await addSpaceMember(owner, space.id, 'contributor', contributor);
    const contributorDefault = await personalDefaultSpace(contributor);

    const created = await api<JsonEnvelope<Created>>(
      '/api/v1/projects',
      201,
      { method: 'POST', body: breakdownBody(space.id) },
      contributor,
    );

    expect(await breakdownIds(contributor, space.id)).toContain(created.data.id);
    expect(await breakdownIds(contributor, contributorDefault.id)).not.toContain(created.data.id);
  }, 120_000);

  it('refuses a breakdown in a Space whose role withholds create_resources', async () => {
    const space = await createSpace(owner, 'breakdown create refused');
    const viewer = await provisionMember(owner);
    await addSpaceMember(owner, space.id, 'viewer', viewer);

    const response = await request(
      '/api/v1/projects',
      { method: 'POST', body: breakdownBody(space.id) },
      viewer,
    );

    expect(response.status).toBe(403);
    expect(await breakdownIds(viewer, space.id)).toEqual([]);
  }, 120_000);

  it('keeps a Space unobservable to a non-member naming it as a creation target', async () => {
    const space = await createSpace(owner, 'create outsider');
    const outsider = await provisionMember(owner);

    const screenplay = await request(
      '/api/v1/screenplays',
      { method: 'POST', body: screenplayBody(space.id) },
      outsider,
    );
    const breakdown = await request(
      '/api/v1/projects',
      { method: 'POST', body: breakdownBody(space.id) },
      outsider,
    );

    expect(screenplay.status).toBe(404);
    expect(breakdown.status).toBe(404);
  }, 120_000);

  it('lets an account create in its owned personal Default when no Space is named', async () => {
    const noSpaceMember = await provisionMember(owner);
    const accountDefault = await personalDefaultSpace(noSpaceMember);
    expect(accountDefault.currentMembership).not.toBeNull();

    const screenplay = await api<JsonEnvelope<Created>>(
      '/api/v1/screenplays',
      201,
      { method: 'POST', body: screenplayBody() },
      noSpaceMember,
    );
    const imported = await api<JsonEnvelope<Created>>(
      '/api/v1/screenplays/import',
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: 'default-space-import.fountain',
          sourceText: 'Title: Default Space Import\n\nINT. ROOM - DAY\n',
        }),
      },
      noSpaceMember,
    );
    const breakdown = await api<JsonEnvelope<Created>>(
      '/api/v1/projects',
      201,
      { method: 'POST', body: breakdownBody() },
      noSpaceMember,
    );
    const templated = await api<JsonEnvelope<Created>>(
      '/api/v1/projects/from-template',
      201,
      {
        method: 'POST',
        body: JSON.stringify({ name: uniqueName('template breakdown'), templateId: 'movie' }),
      },
      noSpaceMember,
    );

    const screenplaysAfter = await screenplayIds(noSpaceMember);
    const breakdownsAfter = await breakdownIds(noSpaceMember);
    expect(screenplaysAfter).toContain(screenplay.data.id);
    expect(screenplaysAfter).toContain(imported.data.id);
    expect(breakdownsAfter).toContain(breakdown.data.id);
    expect(breakdownsAfter).toContain(templated.data.id);
    expect(await screenplayIds(noSpaceMember, accountDefault.id)).toEqual(
      expect.arrayContaining([screenplay.data.id, imported.data.id]),
    );
    expect(await breakdownIds(noSpaceMember, accountDefault.id)).toEqual(
      expect.arrayContaining([breakdown.data.id, templated.data.id]),
    );
  }, 120_000);
});
