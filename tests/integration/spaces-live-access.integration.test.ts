import { beforeAll, describe, expect, it } from 'vitest';

import {
  allResourceTypes,
  permissionsForResourceTier,
  type ResourceType,
} from '../../packages/contracts/src/resource-types';
import {
  resourceTierSchema,
  type ResourceTier,
} from '../../packages/contracts/src/space-permissions';

import {
  acceptInvitation,
  api,
  createViewerInvitation,
  ensureOwnerAuth,
  provisionMovieProject,
  request,
  required,
  tokenFromInvitationUrl,
  uniqueEmail,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';
import { databaseReachable, queryDatabase } from './support/postgres';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const NEVER_GRANTED = ['delete_project', 'invite_members', 'manage_roles', 'manage_member_roles'];

type SpaceRole = { id: string; name: string; resourceTier: ResourceTier; isOwner: boolean };
type Space = { id: string; name: string; version: number; isDefault?: boolean };
type SpaceManagement = {
  id: string;
  version: number;
  roles: SpaceRole[];
  memberships: Array<{ id: string; userId: string; version: number; role: SpaceRole }>;
};
type AvailableUser = { id: string; email: string };
type Resource = { id: string; version: number; access: { permissions: string[] } };
type ResourceFixture = { id: string; type: ResourceType };

function resourcePath(type: ResourceType, resourceId: string): string {
  return type === 'breakdown'
    ? `/api/v1/projects/${resourceId}`
    : `/api/v1/screenplays/${resourceId}`;
}

function invitationsPath(type: ResourceType, resourceId: string): string {
  return `${resourcePath(type, resourceId)}/invitations`;
}

function managementPath(type: ResourceType, resourceId: string): string {
  return `${resourcePath(type, resourceId)}/management`;
}

async function createResource(
  owner: SessionAuth,
  type: ResourceType,
  label: string,
): Promise<ResourceFixture> {
  if (type === 'breakdown') {
    const project = await provisionMovieProject(owner);
    await api(
      `/api/v1/projects/${project.id}`,
      200,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: label, version: project.version }),
      },
      owner,
    );
    return { id: project.id, type };
  }
  const screenplay = await api<JsonEnvelope<{ id: string }>>(
    '/api/v1/screenplays',
    201,
    { method: 'POST', body: JSON.stringify({ title: label, sourceText: `Title: ${label}\n` }) },
    owner,
  );
  return { id: screenplay.data.id, type };
}

async function createSpace(owner: SessionAuth, name: string): Promise<Space> {
  const created = await api<JsonEnvelope<Space>>(
    '/api/v1/spaces',
    201,
    { method: 'POST', body: JSON.stringify({ name }) },
    owner,
  );
  return created.data;
}

async function management(owner: SessionAuth, spaceId: string): Promise<SpaceManagement> {
  return (
    await api<JsonEnvelope<SpaceManagement>>(`/api/v1/spaces/${spaceId}/management`, 200, {}, owner)
  ).data;
}

async function moveFromDefault(
  owner: SessionAuth,
  resource: ResourceFixture,
  targetSpaceId: string,
) {
  return api<JsonEnvelope<{ gainsAccess: string[]; losesAccess: string[] }>>(
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/resources/move`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        resourceType: resource.type,
        resourceId: resource.id,
        targetSpaceId,
      }),
    },
    owner,
  );
}

async function move(
  owner: SessionAuth,
  resource: ResourceFixture,
  sourceSpaceId: string,
  targetSpaceId: string,
) {
  return api<JsonEnvelope<{ gainsAccess: string[]; losesAccess: string[] }>>(
    `/api/v1/spaces/${sourceSpaceId}/resources/move`,
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        resourceType: resource.type,
        resourceId: resource.id,
        targetSpaceId,
      }),
    },
    owner,
  );
}

async function createIndependentUser(owner: SessionAuth, prefix: string) {
  const email = uniqueEmail(prefix);
  const project = await provisionMovieProject(owner);
  const token = await createViewerInvitation(owner, project, email);
  const accepted = await acceptInvitation(token, `${prefix} member`);
  return { auth: accepted.auth, email };
}

async function availableUser(
  owner: SessionAuth,
  spaceId: string,
  email: string,
): Promise<AvailableUser> {
  const users = await api<JsonEnvelope<AvailableUser[]>>(
    `/api/v1/spaces/${spaceId}/available-users`,
    200,
    {},
    owner,
  );
  return required(
    users.data.find((user) => user.email === email),
    `Missing user ${email}`,
  );
}

async function addMember(
  owner: SessionAuth,
  spaceId: string,
  userId: string,
  tier: ResourceTier,
): Promise<void> {
  const space = await management(owner, spaceId);
  const role = required(
    space.roles.find((candidate) => candidate.resourceTier === tier),
    tier,
  );
  await api(
    `/api/v1/spaces/${spaceId}/memberships`,
    201,
    { method: 'POST', body: JSON.stringify({ userId, roleId: role.id }) },
    owner,
  );
}

async function listResourceIds(auth: SessionAuth, type: ResourceType): Promise<string[]> {
  const endpoint = type === 'breakdown' ? '/api/v1/projects' : '/api/v1/screenplays?limit=100';
  const listed = await api<JsonEnvelope<Array<{ id: string }>>>(endpoint, 200, {}, auth);
  return listed.data.map((resource) => resource.id).sort();
}

async function readPermissions(auth: SessionAuth, resource: ResourceFixture): Promise<string[]> {
  const response = await api<JsonEnvelope<Resource>>(
    resourcePath(resource.type, resource.id),
    200,
    {},
    auth,
  );
  return response.data.access.permissions.sort();
}

describe.runIf(databaseReachable())('Spaces live access control', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
  }, 120_000);

  it('leaves a user with no Space membership on exactly their pre-Spaces resource set', async () => {
    const observer = await createIndependentUser(owner, 'spaces-unaffiliated');
    const recipient = await createIndependentUser(owner, 'spaces-shared-member');
    const before = await Promise.all(
      allResourceTypes.map((type) => listResourceIds(observer.auth, type)),
    );
    const resource = await createResource(owner, 'screenplay', 'Unrelated Space screenplay');
    const space = await createSpace(owner, 'Unrelated Space');
    await moveFromDefault(owner, resource, space.id);
    await addMember(
      owner,
      space.id,
      (await availableUser(owner, space.id, recipient.email)).id,
      'viewer',
    );
    const after = await Promise.all(
      allResourceTypes.map((type) => listResourceIds(observer.auth, type)),
    );

    expect(after).toEqual(before);
    expect(
      (await request(resourcePath(resource.type, resource.id), {}, observer.auth)).status,
    ).toBe(404);
  });

  it('preserves direct grants and makes its move preflight match observed access changes', async () => {
    const sourceOnly = await createIndependentUser(owner, 'spaces-source-only');
    const targetOnly = await createIndependentUser(owner, 'spaces-target-only');
    const resource = await createResource(owner, 'screenplay', 'Direct grant survives move');
    const source = await createSpace(owner, 'Move source');
    const target = await createSpace(owner, 'Move target');
    await moveFromDefault(owner, resource, source.id);

    const directManagement = await api<
      JsonEnvelope<{ roles: Array<{ id: string; name: string; isOwner: boolean }> }>
    >(managementPath(resource.type, resource.id), 200, {}, owner);
    const viewerRole = required(
      directManagement.data.roles.find((role) => role.name === 'viewer' && !role.isOwner),
      'screenplay viewer role',
    );
    const directInvitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
      invitationsPath(resource.type, resource.id),
      201,
      {
        method: 'POST',
        body: JSON.stringify({ email: uniqueEmail('spaces-direct-guest'), roleId: viewerRole.id }),
      },
      owner,
    );
    const directGuest = await acceptInvitation(
      tokenFromInvitationUrl(directInvitation.data.invitationUrl),
      'Direct guest',
    );

    const sourceOnlyId = (await availableUser(owner, source.id, sourceOnly.email)).id;
    const targetOnlyId = (await availableUser(owner, target.id, targetOnly.email)).id;
    await addMember(owner, source.id, sourceOnlyId, 'viewer');
    await addMember(owner, target.id, targetOnlyId, 'viewer');
    const preflight = await api<JsonEnvelope<{ gainsAccess: string[]; losesAccess: string[] }>>(
      `/api/v1/spaces/${source.id}/resources/${resource.type}/${resource.id}/move-preflight?targetSpaceId=${target.id}`,
      200,
      {},
      owner,
    );

    expect(preflight.data).toEqual({
      gainsAccess: [targetOnlyId],
      losesAccess: [sourceOnlyId],
    });
    expect(
      (await request(resourcePath(resource.type, resource.id), {}, directGuest.auth)).status,
    ).toBe(200);
    await move(owner, resource, source.id, target.id);
    expect(
      (await request(resourcePath(resource.type, resource.id), {}, directGuest.auth)).status,
    ).toBe(200);
    expect(
      (await request(resourcePath(resource.type, resource.id), {}, sourceOnly.auth)).status,
    ).toBe(404);
    expect(
      (await request(resourcePath(resource.type, resource.id), {}, targetOnly.auth)).status,
    ).toBe(200);
  });

  it('projects every resource type and tier through the real API without excluded authority', async () => {
    const member = await createIndependentUser(owner, 'spaces-tier-member');

    for (const resourceType of allResourceTypes) {
      for (const tier of resourceTierSchema.options) {
        const resource = await createResource(
          owner,
          resourceType,
          `${resourceType} ${tier} Space resource`,
        );
        const space = await createSpace(owner, `${resourceType} ${tier} projection`);
        await moveFromDefault(owner, resource, space.id);
        await addMember(
          owner,
          space.id,
          (await availableUser(owner, space.id, member.email)).id,
          tier,
        );

        const observed = await readPermissions(member.auth, resource);
        const expected = [...permissionsForResourceTier(resourceType, tier)].sort();
        expect(observed).toEqual(expected);
        expect(observed).not.toEqual(expect.arrayContaining(NEVER_GRANTED));
        expect(
          (
            await request(
              resourcePath(resource.type, resource.id),
              { method: 'DELETE' },
              member.auth,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await request(
              invitationsPath(resource.type, resource.id),
              {
                method: 'POST',
                body: JSON.stringify({
                  email: uniqueEmail('spaces-no-reshare'),
                  roleId: '00000000-0000-4000-8000-000000000099',
                }),
              },
              member.auth,
            )
          ).status,
        ).toBe(403);
      }
    }
  }, 120_000);

  it('keeps Default Space membership-free and refuses transfer or deletion after live exercises', async () => {
    expect(
      queryDatabase(
        `SELECT count(*) FROM "space_memberships" WHERE "space_id" = '${DEFAULT_SPACE_ID}'::uuid`,
      ),
    ).toBe('0');
    expect(
      (await request(`/api/v1/spaces/${DEFAULT_SPACE_ID}`, { method: 'DELETE' }, owner)).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/v1/spaces/${DEFAULT_SPACE_ID}/transfer-ownership`,
          {
            method: 'POST',
            body: JSON.stringify({
              newOwnerMembershipId: '00000000-0000-4000-8000-000000000099',
              version: 1,
            }),
          },
          owner,
        )
      ).status,
    ).toBe(404);
  });
});
