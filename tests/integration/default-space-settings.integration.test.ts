import { beforeAll, describe, expect, it } from 'vitest';

import { api, ensureOwnerAuth, type JsonEnvelope, type SessionAuth } from './support/api-client';
import { databaseReachable, queryDatabase } from './support/postgres';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';

type SpaceManagement = {
  id: string;
  isDefault: boolean;
  memberships: unknown[];
  currentMembership: { id: string | null; roleId: string; permissions: string[] } | null;
};

/**
 * The state every Coda instance is in on its first day: **one Space, zero memberships**. It is not
 * an edge case — it is the only state a fresh install can be in, and it is what an upgraded
 * instance is left in too, because the Spaces migration deliberately seeds no memberships.
 *
 * In that state `GET /api/v1/spaces/{DEFAULT_SPACE_ID}/management` returned `404` to everybody
 * (#334): the route resolves through the Space membership choke point, and the Default Space has no
 * members to resolve. Every unit test passed while the flagship feature could not be opened by
 * anyone, on any instance, so this pins the behaviour where it actually failed — over HTTP, against
 * the real database, with the membership table verified empty on both sides of the request.
 *
 * This file sorts ahead of every suite that creates a Space (the integration sequencer runs files
 * in path order), which is what lets it assert the Space *count* and not merely the Default Space's
 * emptiness. Keep that in mind before renaming it.
 */
describe.runIf(databaseReachable())('Default Space settings on a day-one instance', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
  });

  it('opens for the instance administrator, who holds no membership row', async () => {
    expect(queryDatabase('SELECT count(*) FROM "spaces" WHERE "deleted_at" IS NULL')).toBe('1');
    expect(queryDatabase('SELECT count(*) FROM "space_memberships"')).toBe('0');

    const management = await api<JsonEnvelope<SpaceManagement>>(
      `/api/v1/spaces/${DEFAULT_SPACE_ID}/management`,
      200,
      {},
      owner,
    );

    expect(management.data.id).toBe(DEFAULT_SPACE_ID);
    expect(management.data.isDefault).toBe(true);
    expect(management.data.memberships).toEqual([]);
    expect(management.data.currentMembership?.id).toBeNull();
    expect(management.data.currentMembership?.permissions).toContain('manage_space_settings');

    // Reading the settings must not have created the membership it was missing. Zero memberships
    // is the invariant that keeps the Spaces upgrade a no-op for access on every existing install.
    expect(queryDatabase('SELECT count(*) FROM "space_memberships"')).toBe('0');
  });

  it('lists the Default Space for its administrator with a null membership id', async () => {
    const spaces = await api<JsonEnvelope<Array<{ id: string; currentMembership: unknown }>>>(
      '/api/v1/spaces',
      200,
      {},
      owner,
    );

    const defaultSpace = spaces.data.find((space) => space.id === DEFAULT_SPACE_ID);
    expect(defaultSpace?.currentMembership).toMatchObject({ id: null });
  });

  // The other half of the rule — a non-administrator gets an honest `403` rather than a `404` the
  // UI can only render as "check your service connection" — is covered by
  // `space-permission.service.test.ts` and `spaces.service.test.ts`, deliberately not here.
  // Proving it over HTTP needs a second account, and every second account in this suite costs one
  // `POST /api/v1/invitations/accept` against a 10-per-60s per-IP budget that the suites running
  // immediately after this file already spend to their limit. One extra acceptance here stalls
  // them for 10s apiece; the assertion is not worth another suite's failure.
});
