import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ScreenplayCollabCompactionService } from './screenplay-collab-compaction.service';
import { SCREENPLAY_COLLAB_TEXT_KEY, yTextToString } from './screenplay-collab.constants';

// `env()` is read lazily by `candidates()`; give it the required fields it has no default for
// (mirroring realtime.gateway.test.ts) so this file is independent of process.env ordering.
beforeAll(() => {
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.S3_ENDPOINT ??= 'http://localhost:9000';
  process.env.S3_PUBLIC_ENDPOINT ??= 'http://localhost:9001';
  process.env.S3_BUCKET ??= 'test-bucket';
  process.env.S3_ACCESS_KEY ??= 'test';
  process.env.S3_SECRET_KEY ??= 'test-secret';
});

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function textOf(payload: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, payload);
  const text = yTextToString(doc.getText(SCREENPLAY_COLLAB_TEXT_KEY));
  doc.destroy();
  return text;
}

/** Encodes `edits.length` update rows, each appending one edit's text, in `seq` order from 1. */
function logRowsFor(edits: string[]): { seq: number; payload: Buffer }[] {
  const doc = new Y.Doc();
  const text = doc.getText(SCREENPLAY_COLLAB_TEXT_KEY);
  const rows: { seq: number; payload: Buffer }[] = [];
  edits.forEach((edit, index) => {
    const before = Y.encodeStateVector(doc);
    text.insert(text.length, edit);
    rows.push({ seq: index + 1, payload: Buffer.from(Y.encodeStateAsUpdate(doc, before)) });
  });
  doc.destroy();
  return rows;
}

function service(prisma: object) {
  return new ScreenplayCollabCompactionService(prisma as never);
}

describe('ScreenplayCollabCompactionService.compact', () => {
  it('replays the log into a fresh Y.Doc and re-encodes, never merging the raw updates', async () => {
    const edits = ['FADE IN:\n\n', 'INT. KITCHEN - DAY\n', 'ALICE enters.\n'];
    const rows = logRowsFor(edits);
    const fullText = edits.join('');
    const upsert = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: rows.length });
    const tx = {
      screenplayCollabCheckpoint: { upsert },
      screenplayCollabUpdate: { deleteMany },
    };
    const prisma = {
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayCollabUpdate: { findMany: vi.fn().mockResolvedValue(rows) },
      screenplay: { findUnique: vi.fn().mockResolvedValue({ sourceText: fullText }) },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const outcome = await target.compact('screenplay-id');

    expect(outcome.folded).toBe(true);
    expect(outcome.throughSeq).toBe(3);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0] as {
      create: { payload: Buffer; documentDigest: string; throughSeq: number };
    };
    expect(textOf(call.create.payload)).toBe(fullText);
    expect(call.create.documentDigest).toBe(sha256(fullText));
    expect(call.create.throughSeq).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { screenplayId: 'screenplay-id', seq: { lte: 3 } },
    });
  });

  it('folds past an existing checkpoint, applying only the rows after it', async () => {
    const checkpointDoc = new Y.Doc();
    checkpointDoc.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, 'Title: Pilot\n');
    const checkpointPayload = Buffer.from(Y.encodeStateAsUpdate(checkpointDoc));

    const continued = new Y.Doc();
    Y.applyUpdate(continued, checkpointPayload);
    const before = Y.encodeStateVector(continued);
    continued.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(13, 'FADE IN:\n');
    const rowPayload = Buffer.from(Y.encodeStateAsUpdate(continued, before));

    const fullText = 'Title: Pilot\nFADE IN:\n';
    const upsert = vi.fn().mockResolvedValue({});
    const tx = {
      screenplayCollabCheckpoint: { upsert },
      screenplayCollabUpdate: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      screenplayCollabCheckpoint: {
        findUnique: vi.fn().mockResolvedValue({ throughSeq: 9, payload: checkpointPayload }),
      },
      screenplayCollabUpdate: {
        findMany: vi.fn().mockResolvedValue([{ seq: 10, payload: rowPayload }]),
      },
      screenplay: { findUnique: vi.fn().mockResolvedValue({ sourceText: fullText }) },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const outcome = await target.compact('screenplay-id');

    expect(prisma.screenplayCollabUpdate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenplayId: 'screenplay-id', seq: { gt: 9 } } }),
    );
    expect(outcome).toEqual(
      expect.objectContaining({ screenplayId: 'screenplay-id', folded: true, throughSeq: 10 }),
    );
    checkpointDoc.destroy();
    continued.destroy();
  });

  it('is a no-op when there is nothing past the checkpoint to fold', async () => {
    const prisma = {
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayCollabUpdate: { findMany: vi.fn().mockResolvedValue([]) },
      screenplay: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    const target = service(prisma);

    await expect(target.compact('screenplay-id')).resolves.toEqual({
      screenplayId: 'screenplay-id',
      folded: false,
      reason: 'no-op',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips a screenplay that vanished before the fold could run', async () => {
    const rows = logRowsFor(['x']);
    const prisma = {
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayCollabUpdate: { findMany: vi.fn().mockResolvedValue(rows) },
      screenplay: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const target = service(prisma);

    await expect(target.compact('screenplay-id')).resolves.toEqual({
      screenplayId: 'screenplay-id',
      folded: false,
      reason: 'screenplay-missing',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aborts the fold instead of checkpointing a document that disagrees with sourceText', async () => {
    // This is the safety check the ADR calls out explicitly (Decision 3, step 3): a mismatch must
    // never be silently checkpointed, because that would truncate the log out from under content
    // the canonical projection has not caught up to yet.
    const rows = logRowsFor(['FADE IN:\n\n']);
    const prisma = {
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplayCollabUpdate: { findMany: vi.fn().mockResolvedValue(rows) },
      screenplay: { findUnique: vi.fn().mockResolvedValue({ sourceText: 'Something else\n' }) },
      $transaction: vi.fn(),
    };
    const target = service(prisma);

    await expect(target.compact('screenplay-id')).resolves.toEqual({
      screenplayId: 'screenplay-id',
      folded: false,
      reason: 'digest-mismatch',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ScreenplayCollabCompactionService.tick', () => {
  it('folds only screenplays whose log crosses the row or byte threshold', async () => {
    const rows = logRowsFor(['hello ']);
    const groupBy = vi.fn().mockResolvedValue([
      { screenplayId: 'over-row-threshold', _count: { _all: 3_000 }, _sum: { byteLength: 10 } },
      { screenplayId: 'over-byte-threshold', _count: { _all: 5 }, _sum: { byteLength: 2_000_000 } },
      { screenplayId: 'under-both', _count: { _all: 5 }, _sum: { byteLength: 10 } },
    ]);
    const tx = {
      screenplayCollabCheckpoint: { upsert: vi.fn().mockResolvedValue({}) },
      screenplayCollabUpdate: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      screenplayCollabUpdate: { groupBy, findMany: vi.fn().mockResolvedValue(rows) },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: { findUnique: vi.fn().mockResolvedValue({ sourceText: 'hello ' }) },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const outcomes = await target.tick();

    expect(outcomes.map((outcome) => outcome.screenplayId).sort()).toEqual([
      'over-byte-threshold',
      'over-row-threshold',
    ]);
    expect(prisma.screenplay.findUnique).toHaveBeenCalledTimes(2);
  });

  it('continues past one screenplay whose fold throws and still folds the rest', async () => {
    // A corrupt row or a transient database error on one screenplay must not cost the whole tick —
    // mirrors purgeExpiredScreenplays' "continue past a failure, report the survivors" contract.
    const healthyRows = logRowsFor(['ok ']);
    const groupBy = vi.fn().mockResolvedValue([
      { screenplayId: 'broken', _count: { _all: 3_000 }, _sum: { byteLength: 10 } },
      { screenplayId: 'healthy', _count: { _all: 3_000 }, _sum: { byteLength: 10 } },
    ]);
    const tx = {
      screenplayCollabCheckpoint: { upsert: vi.fn().mockResolvedValue({}) },
      screenplayCollabUpdate: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const findMany = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unexpected end of array'))
      .mockResolvedValueOnce(healthyRows);
    const prisma = {
      screenplayCollabUpdate: { groupBy, findMany },
      screenplayCollabCheckpoint: { findUnique: vi.fn().mockResolvedValue(null) },
      screenplay: { findUnique: vi.fn().mockResolvedValue({ sourceText: 'ok ' }) },
      $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const target = service(prisma);

    const outcomes = await target.tick();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(expect.objectContaining({ screenplayId: 'healthy', folded: true }));
  });
});
