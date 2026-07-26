import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';

import {
  acceptInvitation,
  api,
  baseUrl,
  ensureOwnerAuth,
  provisionMember,
  request,
  required,
  tokenFromInvitationUrl,
  uniqueEmail,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';

/**
 * Live-collaboration gateway channel (issue #154, ADR: docs/adr-collaboration-engine-and-
 * transport.md). The permission-matrix and eviction scenarios run unconditionally as part of the
 * standard `pnpm test:integration` pass — they need no special stack configuration and never
 * disrupt the shared stack other integration files run against.
 *
 * Compaction and restart-durability need the stack booted with non-default settings (a low
 * compaction threshold, and — for durability — permission to recreate the `coda` container), so
 * they are opt-in like `storage-hot-swap.integration.test.ts`'s recreate scenario:
 *
 *   CODA_COLLAB_COMPACTION_TEST=1   — stack must run with COLLAB_COMPACTION_ROW_THRESHOLD=1 and a
 *                                     short COLLAB_COMPACTION_TICK_MS (a few seconds).
 *   CODA_COLLAB_RESTART=1           — recreates the `coda` service; requires docker/compose on the
 *                                     runner and CODA_COLLAB_PROJECT to name the running stack.
 */

// This must match `SCREENPLAY_COLLAB_TEXT_KEY` in
// apps/api/src/screenplays/collab/screenplay-collab.constants.ts. It is not part of the public
// wire contract (the gateway carries opaque Yjs bytes); a real client (#155) hardcodes the same
// key to bind its `Y.Text` to the shared document.
const COLLAB_TEXT_KEY = 'source';

// The websocket handshake requires an `Origin` header matching the server's `APP_ORIGIN` exactly
// (realtime.gateway.ts `handleConnection`); `CODA_INTEGRATION_URL` uses the loopback IP form while
// `APP_ORIGIN` is configured with `localhost` in both CI and the local w154 stack, so this
// derivation holds without needing a dedicated env var.
const SOCKET_ORIGIN = process.env.CODA_COLLAB_ORIGIN ?? baseUrl.replace('127.0.0.1', 'localhost');

const COMPOSE_PROJECT = process.env.CODA_COLLAB_PROJECT ?? 'coda-test';
const COMPOSE_FILES = (process.env.CODA_COLLAB_COMPOSE_FILES ?? 'compose.yaml,compose.test.yaml')
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean);
const POSTGRES_PASSWORD =
  process.env.CODA_COLLAB_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD;

interface JoinAccepted {
  status: 200;
  permissions: string[];
  identity: { userId: string; displayName: string };
  update: Uint8Array;
  serverStateVector: Uint8Array;
}
interface StatusOnly {
  status: number;
  message?: string;
}
type JoinAck = JoinAccepted | StatusOnly;
type UpdateAck = { status: 200; seq: number } | StatusOnly;

function connectSocket(auth: SessionAuth): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket: Socket = io(baseUrl, {
      path: '/socket.io/',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie: auth.cookies, origin: SOCKET_ORIGIN },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error: Error) => reject(error));
  });
}

function textFromUpdate(update: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  // `Y.Text` overrides `toString()` at runtime; the shipped yjs types do not express that, so
  // TypeScript sees only `Object.prototype.toString`.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const text = doc.getText(COLLAB_TEXT_KEY).toString();
  doc.destroy();
  return text;
}

function updateAppending(base: Uint8Array | null, addition: string): Uint8Array {
  const doc = new Y.Doc();
  if (base) Y.applyUpdate(doc, base);
  const text = doc.getText(COLLAB_TEXT_KEY);
  const before = Y.encodeStateVector(doc);
  text.insert(text.length, addition);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

async function createScreenplay(auth: SessionAuth, title: string, sourceText: string) {
  const created = await api<JsonEnvelope<{ id: string; version: number }>>(
    '/api/v1/screenplays',
    201,
    { method: 'POST', body: JSON.stringify({ title, sourceText }) },
    auth,
  );
  return created.data;
}

async function inviteToRole(
  auth: SessionAuth,
  screenplayId: string,
  roleName: 'viewer' | 'editor',
  emailPrefix: string,
): Promise<SessionAuth> {
  const management = await api<JsonEnvelope<{ roles: Array<{ id: string; name: string }> }>>(
    `/api/v1/screenplays/${screenplayId}/management`,
    200,
    {},
    auth,
  );
  const role = required(
    management.data.roles.find((candidate) => candidate.name === roleName),
    `seeded ${roleName} role`,
  );
  const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
    `/api/v1/screenplays/${screenplayId}/invitations`,
    201,
    { method: 'POST', body: JSON.stringify({ email: uniqueEmail(emailPrefix), roleId: role.id }) },
    auth,
  );
  const accepted = await acceptInvitation(
    tokenFromInvitationUrl(invitation.data.invitationUrl),
    emailPrefix,
  );
  return accepted.auth;
}

describe('Screenplay live-collaboration channel', () => {
  let owner: SessionAuth;
  let stranger: SessionAuth;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    stranger = await provisionMember(owner);
  }, 120_000);

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  function tracked(socket: Socket): Socket {
    sockets.push(socket);
    return socket;
  }

  it('404s a non-member joining a live screenplay (tenant isolation)', async () => {
    const screenplay = await createScreenplay(owner, 'Owner Only', 'Title: Owner Only\n');
    const socket = tracked(await connectSocket(stranger));

    const ack = (await socket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAck;

    expect(ack).toEqual({ status: 404 });
  });

  it('404s joining a trashed screenplay, even for the owner, and evicts a socket already inside', async () => {
    const screenplay = await createScreenplay(owner, 'Doomed Draft', 'Title: Doomed Draft\n');
    const ownerSocket = tracked(await connectSocket(owner));
    const joinAck = (await ownerSocket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAck;
    expect(joinAck.status).toBe(200);

    const accessChanged = new Promise<{ screenplayId: string }>((resolve) => {
      ownerSocket.once('screenplay-access-changed', resolve);
    });

    expect(
      (await request(`/api/v1/screenplays/${screenplay.id}`, { method: 'DELETE' }, owner)).status,
    ).toBe(200);

    // The eviction signal (ADR left-open item 1) fires as soon as the screenplay is trashed.
    await expect(accessChanged).resolves.toEqual({ screenplayId: screenplay.id });

    const rejoin = (await ownerSocket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAck;
    expect(rejoin).toEqual({ status: 404 });
  });

  it('grants edit_screenplay to an editor and enforces the 403/publish-stays-connected contract on a viewer', async () => {
    const screenplay = await createScreenplay(owner, 'Shared Scene', 'Title: Shared Scene\n');
    const editorAuth = await inviteToRole(owner, screenplay.id, 'editor', 'collab-editor');
    const viewerAuth = await inviteToRole(owner, screenplay.id, 'viewer', 'collab-viewer');

    const editorSocket = tracked(await connectSocket(editorAuth));
    const editorJoin = (await editorSocket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAccepted;
    expect(editorJoin.status).toBe(200);
    expect(editorJoin.permissions).toContain('edit_screenplay');

    const viewerSocket = tracked(await connectSocket(viewerAuth));
    const viewerJoin = (await viewerSocket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAccepted;
    expect(viewerJoin.status).toBe(200);
    expect(viewerJoin.permissions).not.toContain('edit_screenplay');

    // A read-only member is refused 403 on publish, carrying the missing-permission message, and
    // its socket is not dropped — it can still join-screenplay again on the same connection.
    const forbidden = (await viewerSocket.emitWithAck('screenplay-update', {
      screenplayId: screenplay.id,
      update: updateAppending(editorJoin.update, 'FADE IN:\n'),
    })) as UpdateAck;
    expect(forbidden).toEqual({ status: 403, message: 'Missing permission: edit_screenplay' });
    expect(viewerSocket.connected).toBe(true);
    const viewerRejoin = (await viewerSocket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAck;
    expect(viewerRejoin.status).toBe(200);

    // The editor's publish succeeds, allocates a sequence number, and is relayed to the room.
    const relayed = new Promise<{ update: Uint8Array }>((resolve) => {
      viewerSocket.once('screenplay-update', resolve);
    });
    const editorUpdate = updateAppending(editorJoin.update, 'FADE IN:\n');
    const published = (await editorSocket.emitWithAck('screenplay-update', {
      screenplayId: screenplay.id,
      update: editorUpdate,
    })) as UpdateAck;
    expect(published.status).toBe(200);
    // socket.io-client delivers a Buffer for a binary field, not a plain Uint8Array; `toEqual`
    // treats the two as structurally different even though every byte matches, so compare the
    // raw bytes explicitly instead.
    const relayedMessage = await relayed;
    expect(Buffer.from(relayedMessage.update).equals(Buffer.from(editorUpdate))).toBe(true);
    // Generous budget: this is the only scenario that provisions two members, so it is the one that
    // can sit out the per-IP invitation-accept throttle (10/60s) that the access-control suite ahead
    // of it may have spent. `acceptInvitation` waits the window out rather than failing.
  }, 120_000);

  it('seeds a brand-new document from the screenplay pre-collaboration sourceText on first join', async () => {
    const sourceText = 'Title: Legacy Draft\n\nFADE IN:\n';
    const screenplay = await createScreenplay(owner, 'Legacy Draft', sourceText);
    const socket = tracked(await connectSocket(owner));

    const ack = (await socket.emitWithAck('join-screenplay', {
      screenplayId: screenplay.id,
      stateVector: new Uint8Array(),
    })) as JoinAccepted;

    expect(textFromUpdate(ack.update)).toBe(sourceText);
  });
});

describe.runIf(process.env.CODA_COLLAB_COMPACTION_TEST === '1')(
  'Screenplay collaboration compaction (opt-in; requires a low COLLAB_COMPACTION_ROW_THRESHOLD)',
  () => {
    let owner: SessionAuth;

    beforeAll(async () => {
      owner = await ensureOwnerAuth();
    }, 120_000);

    function psql(sql: string): string {
      return execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          COMPOSE_PROJECT,
          ...COMPOSE_FILES.flatMap((file) => ['-f', file]),
          'exec',
          '-T',
          '-e',
          `PGPASSWORD=${POSTGRES_PASSWORD ?? ''}`,
          'postgres',
          'psql',
          '-U',
          'coda',
          '-d',
          'coda',
          '-tAc',
          sql,
        ],
        { encoding: 'utf8' },
      ).trim();
    }

    it('folds the bootstrap log row into a checkpoint whose digest matches sourceText', async () => {
      const sourceText = 'Title: Compaction Fixture\n';
      const screenplay = await createScreenplay(owner, 'Compaction Fixture', sourceText);
      const socket = await connectSocket(owner);
      try {
        const ack = (await socket.emitWithAck('join-screenplay', {
          screenplayId: screenplay.id,
          stateVector: new Uint8Array(),
        })) as JoinAccepted;
        expect(textFromUpdate(ack.update)).toBe(sourceText);

        // Deliberately NOT asserting that the log holds one row at this point. This scenario only
        // runs with the threshold pinned to a single row and a two-second tick, so the compaction
        // job legitimately races the assertion and can have folded (and deleted) the bootstrap row
        // before it is read — the feature working faster than the test, reported as
        // `expected '0' to be '1'`. The invariant that matters is asserted below instead, and it is
        // strictly stronger: a checkpoint at `through_seq = 1` can only exist by folding a log row
        // whose `seq` was 1.
        let checkpointRow = '';
        for (let attempt = 0; attempt < 20; attempt += 1) {
          checkpointRow = psql(
            `SELECT through_seq || ':' || document_digest FROM screenplay_collab_checkpoints ` +
              `WHERE screenplay_id = '${screenplay.id}'`,
          );
          if (checkpointRow) break;
          await sleep(1_000);
        }
        expect(checkpointRow).not.toBe('');
        const [throughSeq, digest] = checkpointRow.split(':');
        expect(throughSeq).toBe('1');
        expect(digest).toHaveLength(64);

        // The fold deletes what it just checkpointed.
        expect(
          psql(
            `SELECT count(*) FROM screenplay_collab_updates WHERE screenplay_id = '${screenplay.id}'`,
          ),
        ).toBe('0');
      } finally {
        socket.disconnect();
      }
    });
  },
);

describe.runIf(process.env.CODA_COLLAB_RESTART === '1')(
  'Screenplay collaboration durability across an API restart (opt-in)',
  () => {
    let owner: SessionAuth;

    beforeAll(async () => {
      owner = await ensureOwnerAuth();
    }, 120_000);

    async function waitForReady(): Promise<void> {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
          if ((await request('/api/v1/health/ready')).status === 200) return;
        } catch {
          // container still coming back up
        }
        await sleep(2_000);
      }
      throw new Error('Coda did not become ready after recreate');
    }

    it('replays the update log byte-identically to a fresh client after the API process restarts', async () => {
      const sourceText = 'Title: Restart Fixture\n';
      const screenplay = await createScreenplay(owner, 'Restart Fixture', sourceText);
      const before = await connectSocket(owner);
      const joined = (await before.emitWithAck('join-screenplay', {
        screenplayId: screenplay.id,
        stateVector: new Uint8Array(),
      })) as JoinAccepted;
      const published = updateAppending(joined.update, 'FADE IN:\n\nINT. KITCHEN - DAY\n');
      const publishAck = (await before.emitWithAck('screenplay-update', {
        screenplayId: screenplay.id,
        update: published,
      })) as UpdateAck;
      expect(publishAck.status).toBe(200);
      // `published` is only the incremental delta since the join (what a real client publishes);
      // reconstructing the expected full text means replaying the join's base plus that delta,
      // not decoding the delta alone.
      const beforeDoc = new Y.Doc();
      Y.applyUpdate(beforeDoc, joined.update);
      Y.applyUpdate(beforeDoc, published);
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- see textFromUpdate above.
      const expectedText = beforeDoc.getText(COLLAB_TEXT_KEY).toString();
      beforeDoc.destroy();
      before.disconnect();

      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          COMPOSE_PROJECT,
          ...COMPOSE_FILES.flatMap((file) => ['-f', file]),
          'up',
          '--detach',
          '--force-recreate',
          '--no-deps',
          'coda',
        ],
        { stdio: 'inherit' },
      );
      await waitForReady();

      // A brand-new process, no in-memory state: a fresh socket must replay the same document
      // purely from the durable Postgres log.
      const after = await connectSocket(owner);
      try {
        const rejoined = (await after.emitWithAck('join-screenplay', {
          screenplayId: screenplay.id,
          stateVector: new Uint8Array(),
        })) as JoinAccepted;
        expect(textFromUpdate(rejoined.update)).toBe(expectedText);
      } finally {
        after.disconnect();
      }
    });
  },
);
