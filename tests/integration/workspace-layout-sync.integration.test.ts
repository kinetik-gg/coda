import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  authFrom,
  ensureOwnerAuth,
  ownerEmail,
  ownerPassword,
  provisionMovieProject,
  request,
  responseJson,
  type JsonEnvelope,
  type Project,
  type SessionAuth,
} from './support/api-client';

/**
 * Reproduces #120: two browser sessions of the same account editing the breakdown workspace
 * layout race on the optimistic-concurrency revision. The server must serialise them into one
 * winner and one 409 (never two silent winners), and the loser must be able to self-heal by
 * refetching the current revision and retrying — which is exactly what the client now does
 * automatically. Publish carries its own revision, so a concurrent publish is reproduced too.
 */

type StoredLayout = { layout: unknown; revision: number };
type LayoutState = { personal: StoredLayout; default: StoredLayout; canPublish: boolean };

/** A second, independent session for the same owner account — two "browser tabs", one membership. */
async function secondOwnerSession(): Promise<SessionAuth> {
  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  await responseJson(login, 201);
  return authFrom(login);
}

describe('Workspace layout sync under concurrent sessions', () => {
  let sessionA: SessionAuth;
  let sessionB: SessionAuth;
  let project: Project;

  beforeAll(async () => {
    sessionA = await ensureOwnerAuth();
    sessionB = await secondOwnerSession();
    project = await provisionMovieProject(sessionA);
  });

  const layoutUrl = () => `/api/v1/projects/${project.id}/workspace-layout`;
  const getLayout = (auth: SessionAuth) =>
    api<JsonEnvelope<LayoutState>>(layoutUrl(), 200, {}, auth);
  const putLayout = (auth: SessionAuth, layout: unknown, expectedRevision: number) =>
    request(
      layoutUrl(),
      { method: 'PUT', body: JSON.stringify({ layout, expectedRevision }) },
      auth,
    );
  const publish = (auth: SessionAuth, personalRevision: number, defaultRevision: number) =>
    request(
      `${layoutUrl()}/publish`,
      { method: 'POST', body: JSON.stringify({ personalRevision, defaultRevision }) },
      auth,
    );

  it('serialises two concurrent personal saves into one winner and one 409', async () => {
    const start = await getLayout(sessionA);
    const { layout, revision } = start.data.personal;

    const [a, b] = await Promise.all([
      putLayout(sessionA, layout, revision),
      putLayout(sessionB, layout, revision),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('lets the losing session self-heal by refetching the revision and retrying once', async () => {
    const start = await getLayout(sessionA);
    const { layout, revision } = start.data.personal;

    const [a, b] = await Promise.all([
      putLayout(sessionA, layout, revision),
      putLayout(sessionB, layout, revision),
    ]);
    const loser = a.status === 409 ? sessionA : sessionB;
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    // The rebase-retry the client performs: refetch the current revision, replay the write once.
    const rebased = await getLayout(loser);
    const retry = await putLayout(loser, layout, rebased.data.personal.revision);
    expect(retry.status).toBe(200);
  });

  it('rejects a publish that lost the default revision, then accepts an overwrite after refetch', async () => {
    const start = await getLayout(sessionA);
    const personalRevision = start.data.personal.revision;
    const defaultRevision = start.data.default.revision;

    const [a, b] = await Promise.all([
      publish(sessionA, personalRevision, defaultRevision),
      publish(sessionB, personalRevision, defaultRevision),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    // "Publish anyway": the loser refetches the bumped default revision and republishes.
    const latest = await getLayout(sessionA);
    const overwrite = await publish(
      sessionA,
      latest.data.personal.revision,
      latest.data.default.revision,
    );
    expect(overwrite.status).toBe(201);
  });
});
