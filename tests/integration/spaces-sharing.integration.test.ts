import { beforeAll, describe, expect, it } from 'vitest';

import {
  allResourceTypes,
  permissionsForResourceTier,
} from '../../packages/contracts/src/resource-types';
import { resourceTierSchema } from '../../packages/contracts/src/space-permissions';
import {
  api,
  ensureOwnerAuth,
  provisionMember,
  provisionMovieProject,
  request,
  required,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';
import { databaseReachable, queryDatabase } from './support/postgres';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const excludedPermissions = [
  'delete_project',
  'invite_members',
  'manage_roles',
  'manage_member_roles',
];

type Space = { id: string; version: number };
type SpaceRole = { id: string; name: string; resourceTier: string };
type SpaceManagement = { roles: SpaceRole[] };
type UserSession = { id: string };
type ResourceAccess = { access: { permissions: string[] } };

function spaceName(label: string): string {
  return `Integration ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
}

async function createSpace(owner: SessionAuth, label: string): Promise<Space> {
  const result = await api<JsonEnvelope<Space>>(
    '/api/v1/spaces',
    201,
    { method: 'POST', body: JSON.stringify({ name: spaceName(label) }) },
    owner,
  );
  return result.data;
}

async function spaceRole(owner: SessionAuth, spaceId: string, name: string): Promise<SpaceRole> {
  const management = await api<JsonEnvelope<SpaceManagement>>(
    `/api/v1/spaces/${spaceId}/management`,
    200,
    {},
    owner,
  );
  return required(
    management.data.roles.find((role) => role.name === name),
    `Missing ${name} role`,
  );
}

async function userId(auth: SessionAuth): Promise<string> {
  const session = await api<JsonEnvelope<UserSession>>('/api/v1/auth/session', 200, {}, auth);
  return session.data.id;
}

async function addSpaceMember(
  owner: SessionAuth,
  spaceId: string,
  roleName: string,
  member: SessionAuth,
): Promise<string> {
  const [role, memberId] = await Promise.all([spaceRole(owner, spaceId, roleName), userId(member)]);
  await api(
    `/api/v1/spaces/${spaceId}/memberships`,
    201,
    { method: 'POST', body: JSON.stringify({ userId: memberId, roleId: role.id }) },
    owner,
  );
  return memberId;
}

async function createScreenplay(owner: SessionAuth, title: string): Promise<string> {
  const screenplay = await api<JsonEnvelope<{ id: string }>>(
    '/api/v1/screenplays',
    201,
    {
      method: 'POST',
      body: JSON.stringify({ title, sourceText: `Title: ${title}\n` }),
    },
    owner,
  );
  return screenplay.data.id;
}

async function moveResource(
  owner: SessionAuth,
  sourceSpaceId: string,
  resourceType: (typeof allResourceTypes)[number],
  resourceId: string,
  targetSpaceId: string,
): Promise<{ gainsAccess: string[]; losesAccess: string[] }> {
  return (
    await api<JsonEnvelope<{ gainsAccess: string[]; losesAccess: string[] }>>(
      `/api/v1/spaces/${sourceSpaceId}/resources/move`,
      201,
      { method: 'POST', body: JSON.stringify({ resourceType, resourceId, targetSpaceId }) },
      owner,
    )
  ).data;
}

async function preflightMove(
  owner: SessionAuth,
  sourceSpaceId: string,
  resourceType: (typeof allResourceTypes)[number],
  resourceId: string,
  targetSpaceId: string,
): Promise<{ gainsAccess: string[]; losesAccess: string[] }> {
  return (
    await api<JsonEnvelope<{ gainsAccess: string[]; losesAccess: string[] }>>(
      `/api/v1/spaces/${sourceSpaceId}/resources/${resourceType}/${resourceId}/move-preflight?targetSpaceId=${targetSpaceId}`,
      200,
      {},
      owner,
    )
  ).data;
}

async function projectIds(auth: SessionAuth, spaceId?: string): Promise<string[]> {
  const suffix = spaceId ? `?spaceId=${spaceId}` : '';
  const projects = await api<JsonEnvelope<Array<{ id: string }>>>(
    `/api/v1/projects${suffix}`,
    200,
    {},
    auth,
  );
  return projects.data.map((project) => project.id).sort();
}

async function screenplayIds(auth: SessionAuth, spaceId?: string): Promise<string[]> {
  const suffix = spaceId ? `?spaceId=${spaceId}` : '';
  const screenplays = await api<JsonEnvelope<Array<{ id: string }>>>(
    `/api/v1/screenplays${suffix}`,
    200,
    {},
    auth,
  );
  return screenplays.data.map((screenplay) => screenplay.id).sort();
}

describe('Spaces sharing through the application stack', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
  }, 120_000);

  it('keeps a user with no Space membership on precisely their pre-Spaces resource set', async () => {
    const noSpaceMember = await provisionMember(owner);
    const before = await projectIds(noSpaceMember);
    const privateDefault = await provisionMovieProject(owner);
    const space = await createSpace(owner, 'no-space isolation');
    const spaceMember = await provisionMember(owner);
    await addSpaceMember(owner, space.id, 'viewer', spaceMember);
    await moveResource(owner, DEFAULT_SPACE_ID, 'breakdown', privateDefault.id, space.id);

    expect(await projectIds(noSpaceMember)).toEqual(before);
    expect(await projectIds(noSpaceMember, space.id)).toEqual([]);
    expect((await request(`/api/v1/projects/${privateDefault.id}`, {}, noSpaceMember)).status).toBe(
      404,
    );
  }, 120_000);

  it('preserves direct grants while move preflight exactly predicts Space-derived access changes', async () => {
    const project = await provisionMovieProject(owner);
    const source = await createSpace(owner, 'move source');
    const target = await createSpace(owner, 'move target');
    const directMember = await provisionMember(owner);
    const sourceMember = await provisionMember(owner);
    const targetMember = await provisionMember(owner);
    const directMemberId = await userId(directMember);
    const management = await api<JsonEnvelope<{ roles: Array<{ id: string; name: string }> }>>(
      `/api/v1/projects/${project.id}/management`,
      200,
      {},
      owner,
    );
    const viewer = required(
      management.data.roles.find((role) => role.name === 'viewer'),
      'Project viewer role',
    );
    await api(
      `/api/v1/projects/${project.id}/memberships`,
      201,
      { method: 'POST', body: JSON.stringify({ userId: directMemberId, roleId: viewer.id }) },
      owner,
    );
    const sourceMemberId = await addSpaceMember(owner, source.id, 'viewer', sourceMember);
    const targetMemberId = await addSpaceMember(owner, target.id, 'viewer', targetMember);
    await moveResource(owner, DEFAULT_SPACE_ID, 'breakdown', project.id, source.id);

    const predicted = await preflightMove(owner, source.id, 'breakdown', project.id, target.id);
    expect(predicted).toEqual({ gainsAccess: [targetMemberId], losesAccess: [sourceMemberId] });
    expect(await moveResource(owner, source.id, 'breakdown', project.id, target.id)).toMatchObject(
      predicted,
    );
    expect((await request(`/api/v1/projects/${project.id}`, {}, directMember)).status).toBe(200);
    expect((await request(`/api/v1/projects/${project.id}`, {}, sourceMember)).status).toBe(404);
    expect((await request(`/api/v1/projects/${project.id}`, {}, targetMember)).status).toBe(200);
  }, 120_000);

  it('projects every resource tier from the contracts registry and never grants excluded powers', async () => {
    const member = await provisionMember(owner);
    for (const resourceType of allResourceTypes) {
      for (const tier of resourceTierSchema.options) {
        const space = await createSpace(owner, `${resourceType}-${tier}`);
        const resourceId =
          resourceType === 'breakdown'
            ? (await provisionMovieProject(owner)).id
            : await createScreenplay(owner, spaceName(`${resourceType}-${tier}`));
        await moveResource(owner, DEFAULT_SPACE_ID, resourceType, resourceId, space.id);
        await addSpaceMember(owner, space.id, tier, member);
        const response = await api<JsonEnvelope<ResourceAccess>>(
          resourceType === 'breakdown'
            ? `/api/v1/projects/${resourceId}`
            : `/api/v1/screenplays/${resourceId}`,
          200,
          {},
          member,
        );
        const observed = response.data.access.permissions;
        expect(observed).toEqual(permissionsForResourceTier(resourceType, tier));
        expect(observed).not.toEqual(expect.arrayContaining(excludedPermissions));
      }
    }
  }, 120_000);

  it.runIf(databaseReachable())(
    'keeps Default Space membership-free and refuses its deletion and ownership transfer',
    () => {
      expect(
        queryDatabase(
          `SELECT count(*) FROM "space_memberships" WHERE "space_id" = '${DEFAULT_SPACE_ID}'::uuid`,
        ),
      ).toBe('0');
    },
  );

  it('refuses Default Space mutations through the API', async () => {
    const transfer = await request(
      `/api/v1/spaces/${DEFAULT_SPACE_ID}/transfer-ownership`,
      {
        method: 'POST',
        body: JSON.stringify({
          newOwnerMembershipId: '00000000-0000-4000-8000-000000000001',
          version: 1,
        }),
      },
      owner,
    );
    expect(transfer.status).toBe(409);
    expect([403, 404]).toContain(
      (await request(`/api/v1/spaces/${DEFAULT_SPACE_ID}`, { method: 'DELETE' }, owner)).status,
    );
  });

  it('makes a Space member see every in-Space resource and no resource left in Default', async () => {
    const space = await createSpace(owner, 'headline isolation');
    const sharedProject = await provisionMovieProject(owner);
    const sharedScreenplay = await createScreenplay(owner, spaceName('shared screenplay'));
    const privateProject = await provisionMovieProject(owner);
    const privateScreenplay = await createScreenplay(owner, spaceName('private screenplay'));
    const member = await provisionMember(owner);
    await moveResource(owner, DEFAULT_SPACE_ID, 'breakdown', sharedProject.id, space.id);
    await moveResource(owner, DEFAULT_SPACE_ID, 'screenplay', sharedScreenplay, space.id);
    await addSpaceMember(owner, space.id, 'viewer', member);

    expect(await projectIds(member, space.id)).toEqual([sharedProject.id]);
    expect(await screenplayIds(member, space.id)).toEqual([sharedScreenplay]);
    expect(await projectIds(member)).not.toContain(privateProject.id);
    expect(await screenplayIds(member)).not.toContain(privateScreenplay);
  }, 120_000);
});
