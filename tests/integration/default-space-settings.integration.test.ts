import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  ensureOwnerAuth,
  personalDefaultSpace,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';
import { databaseReachable, queryDatabase } from './support/postgres';

type SpaceManagement = {
  id: string;
  isDefault: boolean;
  memberships: unknown[];
  currentMembership: { id: string | null; roleId: string; permissions: string[] } | null;
};

/**
 * A fresh account owns one personal Default Space through an ordinary owner membership. This pins
 * the invariant over HTTP and against the real database rather than relying on a special instance
 * administrator authority path.
 *
 * This file sorts ahead of every suite that creates a Space (the integration sequencer runs files
 * in path order), which is what lets it assert the Space *count* and not merely the Default Space's
 * emptiness. Keep that in mind before renaming it.
 */
describe.runIf(databaseReachable())('Default Space settings on a day-one instance', () => {
  let owner: SessionAuth;
  let defaultSpaceId: string;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    defaultSpaceId = (await personalDefaultSpace(owner)).id;
  });

  it('opens for its owner through an ordinary membership row', async () => {
    expect(queryDatabase('SELECT count(*) FROM "spaces" WHERE "deleted_at" IS NULL')).toBe('1');
    expect(queryDatabase('SELECT count(*) FROM "space_memberships"')).toBe('1');

    const management = await api<JsonEnvelope<SpaceManagement>>(
      `/api/v1/spaces/${defaultSpaceId}/management`,
      200,
      {},
      owner,
    );

    expect(management.data.id).toBe(defaultSpaceId);
    expect(management.data.isDefault).toBe(true);
    expect(management.data.memberships).toHaveLength(1);
    expect(management.data.currentMembership?.id).toEqual(expect.any(String));
    expect(management.data.currentMembership?.permissions).toContain('manage_space_settings');

    expect(queryDatabase('SELECT count(*) FROM "space_memberships"')).toBe('1');
  });

  it('lists the personal Default with its owner membership id', async () => {
    const spaces = await api<
      JsonEnvelope<Array<{ id: string; currentMembership: { id: string } | null }>>
    >('/api/v1/spaces', 200, {}, owner);

    const defaultSpace = spaces.data.find((space) => space.id === defaultSpaceId);
    expect(typeof defaultSpace?.currentMembership?.id).toBe('string');
  });
});
