import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ScreenplayCollabLogService } from './screenplay-collab-log.service';
import { SCREENPLAY_COLLAB_TEXT_KEY, yTextToString } from './screenplay-collab.constants';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('conflict', { code, clientVersion: '6.19.3' });
}

function textOf(update: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const text = yTextToString(doc.getText(SCREENPLAY_COLLAB_TEXT_KEY));
  doc.destroy();
  return text;
}

/** Builds a real Yjs update that inserts `text` into a brand-new document. */
function updateInserting(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, text);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

function service(prisma: object, permissions: object = {}) {
  return new ScreenplayCollabLogService(prisma as never, permissions as never);
}

describe('ScreenplayCollabLogService.assertJoin', () => {
  it('grants an identity and permission set for a member of a live screenplay', async () => {
    const prisma = {
      screenplay: { findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Ada' }) },
    };
    const permissions = {
      assert: vi.fn().mockResolvedValue({
        role: {
          permissions: [{ permission: 'read_screenplay' }, { permission: 'edit_screenplay' }],
        },
      }),
    };
    const target = service(prisma, permissions);

    const identity = await target.assertJoin('user-1', 'screenplay-id');

    expect(permissions.assert).toHaveBeenCalledWith('user-1', 'screenplay-id', 'read_screenplay');
    expect(identity).toEqual({
      userId: 'user-1',
      displayName: 'Ada',
      permissions: ['read_screenplay', 'edit_screenplay'],
    });
  });

  it('404s a non-member (tenant isolation)', async () => {
    const permissions = {
      assert: vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found')),
    };
    const target = service({}, permissions);

    await expect(target.assertJoin('stranger', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never lets a Forbidden from the permission check leak as anything but 404', async () => {
    // Every seeded role carries read_screenplay, but a future, unusually restrictive role could
    // omit it; the join handshake must still never distinguish this from a non-member.
    const permissions = {
      assert: vi.fn().mockRejectedValue(new ForbiddenException('Missing permission')),
    };
    const target = service({}, permissions);

    await expect(target.assertJoin('user-1', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a trashed screenplay even though the membership still resolves', async () => {
    const prisma = { screenplay: { findFirst: vi.fn().mockResolvedValue(null) } };
    const permissions = {
      assert: vi.fn().mockResolvedValue({ role: { permissions: [] } }),
    };
    const target = service(prisma, permissions);

    await expect(target.assertJoin('user-1', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ScreenplayCollabLogService.ensureBootstrapped', () => {
  it('seeds the first log row from sourceText exactly once', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ sourceText: 'Title: Pilot\n', ownerUserId: 'owner-id' }),
      },
    };
    const target = service(prisma);

    await target.ensureBootstrapped('screenplay-id');

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]![0] as {
      data: { seq: number; authorUserId: string; payload: Buffer };
    };
    expect(call.data.seq).toBe(1);
    expect(call.data.authorUserId).toBe('owner-id');
    expect(textOf(call.data.payload)).toBe('Title: Pilot\n');
  });

  it('is a no-op once a log row already exists', async () => {
    const create = vi.fn();
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn() },
      screenplay: { findUnique: vi.fn() },
    };
    const target = service(prisma);

    await target.ensureBootstrapped('screenplay-id');

    expect(create).not.toHaveBeenCalled();
    expect(prisma.screenplay.findUnique).not.toHaveBeenCalled();
  });

  it('is a no-op once a checkpoint already exists', async () => {
    const create = vi.fn();
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue({ screenplayId: 'x' }) },
      screenplay: { findUnique: vi.fn() },
    };
    const target = service(prisma);

    await target.ensureBootstrapped('screenplay-id');

    expect(create).not.toHaveBeenCalled();
  });

  it('discards its seed when another join wins the bootstrap race', async () => {
    const create = vi.fn().mockRejectedValue(knownError('P2002'));
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: {
        findUnique: vi.fn().mockResolvedValue({ sourceText: 'Race\n', ownerUserId: 'owner-id' }),
      },
    };
    const target = service(prisma);

    await expect(target.ensureBootstrapped('screenplay-id')).resolves.toBeUndefined();
  });

  it('propagates an unexpected error from the seed insert', async () => {
    const create = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: {
        findUnique: vi.fn().mockResolvedValue({ sourceText: 'Text\n', ownerUserId: 'owner-id' }),
      },
    };
    const target = service(prisma);

    await expect(target.ensureBootstrapped('screenplay-id')).rejects.toThrow(
      'database unavailable',
    );
  });

  it('is a no-op if the screenplay vanished before the seed could be built', async () => {
    const create = vi.fn();
    const prisma = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const target = service(prisma);

    await target.ensureBootstrapped('screenplay-id');

    expect(create).not.toHaveBeenCalled();
  });
});

describe('ScreenplayCollabLogService.loadSyncState', () => {
  it('replays a checkpoint plus the log after it into a byte-identical document', async () => {
    const seed = new Y.Doc();
    seed.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, 'FADE IN:\n\n');
    const checkpointPayload = Buffer.from(Y.encodeStateAsUpdate(seed));

    const continued = new Y.Doc();
    Y.applyUpdate(continued, checkpointPayload);
    continued.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(10, 'INT. KITCHEN - DAY\n');
    // Only the delta after the checkpoint's state is a real log row.
    const logPayload = Buffer.from(Y.encodeStateAsUpdate(continued, Y.encodeStateVector(seed)));

    const prisma = {
      screenplayCollabCheckpoint: {
        findUnique: vi.fn().mockResolvedValue({ throughSeq: 5, payload: checkpointPayload }),
      },
      screenplayCollabUpdate: {
        findMany: vi.fn().mockResolvedValue([{ payload: logPayload }]),
      },
    };
    const target = service(prisma);

    const { update, serverStateVector } = await target.loadSyncState(
      'screenplay-id',
      new Uint8Array(),
    );

    expect(prisma.screenplayCollabUpdate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenplayId: 'screenplay-id', seq: { gt: 5 } } }),
    );
    expect(textOf(update)).toBe('FADE IN:\n\nINT. KITCHEN - DAY\n');

    const client = new Y.Doc();
    Y.applyUpdate(client, update);
    expect(Y.encodeStateVector(client)).toEqual(serverStateVector);
    client.destroy();
    seed.destroy();
    continued.destroy();
  });

  it('sends only what the caller is missing when it already holds part of the document', async () => {
    const authored = new Y.Doc();
    authored.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, 'Title: Pilot\n');
    const fullUpdate = Buffer.from(Y.encodeStateAsUpdate(authored));

    const prisma = {
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayCollabUpdate: { findMany: vi.fn().mockResolvedValue([{ payload: fullUpdate }]) },
    };
    const target = service(prisma);

    // The caller already has the whole document; its state vector should make the diff empty.
    const clientStateVector = Y.encodeStateVector(authored);
    const { update } = await target.loadSyncState('screenplay-id', clientStateVector);

    expect(textOf(update)).toBe('');
    authored.destroy();
  });
});

describe('ScreenplayCollabLogService.appendUpdate', () => {
  it('allocates the next sequence after the current log tail', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue({ seq: 7 }), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    const seq = await target.appendUpdate(
      'screenplay-id',
      'author-id',
      'client-abc',
      updateInserting('x'),
    );

    expect(seq).toBe(8);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]![0] as {
      data: { screenplayId: string; seq: number; authorUserId: string };
    };
    expect(call.data.screenplayId).toBe('screenplay-id');
    expect(call.data.seq).toBe(8);
    expect(call.data.authorUserId).toBe('author-id');
  });

  it('allocates past the checkpoint tail once the log itself is empty', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue({ throughSeq: 42 }) },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    const seq = await target.appendUpdate(
      'screenplay-id',
      'author-id',
      'client-abc',
      new Uint8Array(),
    );

    expect(seq).toBe(43);
  });

  it('retries once past a lost sequence race and then succeeds', async () => {
    const create = vi.fn().mockRejectedValueOnce(knownError('P2002')).mockResolvedValueOnce({});
    const tx = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue({ seq: 1 }), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    const seq = await target.appendUpdate(
      'screenplay-id',
      'author-id',
      'client-abc',
      new Uint8Array(),
    );

    expect(seq).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting its retry budget', async () => {
    const create = vi.fn().mockRejectedValue(knownError('P2034'));
    const tx = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue({ seq: 1 }), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    await expect(
      target.appendUpdate('screenplay-id', 'author-id', 'client-abc', new Uint8Array()),
    ).rejects.toThrow('Could not allocate a collab update sequence number');
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('does not swallow an unrelated database error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const tx = {
      screenplayCollabUpdate: { findFirst: vi.fn().mockResolvedValue(null), create },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
    const target = service(prisma);

    await expect(
      target.appendUpdate('screenplay-id', 'author-id', 'client-abc', new Uint8Array()),
    ).rejects.toThrow('database unavailable');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
