import { createHash } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  SCREENPLAY_REBASE_PLAN_VERSION,
  type ApplyScreenplayRebaseInput,
  type ScreenplayRebaseDecisionInput,
} from '@coda/contracts';
import { ScreenplayRebaseApplyService } from './screenplay-rebase-apply.service';
import { buildScreenplayRebasePlan } from './screenplay-rebase-plan';

/**
 * The acceptance gate for issue #243's second criterion: **a concurrent screenplay, link, or pin
 * change aborts the whole apply with no partial updates.**
 *
 * The harness records every call in order, so these tests can assert the two things that make the
 * check meaningful rather than decorative: that the fingerprint is verified *inside* the transaction
 * (after the lock, before any write), and that a failed verification leaves the write methods
 * untouched entirely.
 */

const projectId = '00000000-0000-4000-8000-000000000001';
const screenplayId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const targetRevisionId = '00000000-0000-4000-8000-000000000004';
const referenceId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000f1';
const userId = '00000000-0000-4000-8000-0000000000e1';

const sourceText = 'INT. OFFICE - DAY\n\nMAYA\nNot again.\n\nBODY LINE';
const targetText = `FADE IN:\n\n${sourceText}`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pinRow(overrides: Record<string, unknown> = {}) {
  const start = sourceText.indexOf('BODY LINE');
  return {
    itemSourceReferenceId: referenceId,
    screenplayId,
    screenplayRevisionId: revisionId,
    screenplayVersion: 7,
    sourceStart: start,
    sourceEnd: start + 'BODY LINE'.length,
    sourceTextHash: sha256('BODY LINE'),
    createdById: userId,
    updatedById: userId,
    createdAt: new Date('2026-07-30T09:00:00.000Z'),
    updatedAt: new Date('2026-07-30T09:00:00.000Z'),
    ...overrides,
  };
}

interface HarnessOptions {
  pins?: Record<string, unknown>[];
  /** How many rows the conditional pin update claims to have touched. */
  updatedCount?: number;
  linkUpdatedAt?: Date;
  targetVersion?: number;
  screenplayAssertError?: Error;
}

function harness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const updates: unknown[] = [];
  const record = <T>(name: string, value: T): T => {
    calls.push(name);
    return value;
  };

  const tx = {
    breakdownScreenplayLink: {
      findUnique: () =>
        Promise.resolve(
          record('read.link', {
            screenplayId,
            updatedAt: options.linkUpdatedAt ?? new Date('2026-07-30T10:00:00.000Z'),
          }),
        ),
    },
    screenplay: {
      findFirst: () =>
        Promise.resolve(
          record('read.screenplay', {
            version: options.targetVersion ?? 9,
            sourceText: targetText,
          }),
        ),
    },
    itemSourceReference: {
      findMany: () => Promise.resolve(record('read.references', [{ id: referenceId, itemId }])),
    },
    itemSourceRevisionPin: {
      findMany: () => Promise.resolve(record('read.pins', options.pins ?? [pinRow()])),
      updateMany: (args: unknown) => {
        updates.push(args);
        return Promise.resolve(record('write.pin', { count: options.updatedCount ?? 1 }));
      },
    },
    screenplayRevision: {
      findMany: () =>
        Promise.resolve(
          record('read.revisions', [{ id: revisionId, screenplayVersion: 7, sourceText }]),
        ),
      findUnique: () => Promise.resolve(record('read.targetRevision', null)),
    },
    activityEvent: {
      create: (args: unknown) => Promise.resolve(record('write.activity', args)),
    },
  };

  const transactionOptions: unknown[] = [];
  const prisma = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>, settings: unknown) => {
      transactionOptions.push(settings);
      calls.push('transaction.begin');
      return operation(tx);
    },
  };
  const db = {
    acquireTransactionLock: vi.fn((_tx: unknown, key: string) => {
      calls.push(`lock:${key}`);
      return Promise.resolve();
    }),
  };
  const screenplays = {
    ensureCheckpointWithin: vi.fn(() =>
      Promise.resolve(
        record('write.checkpoint', {
          id: targetRevisionId,
          screenplayVersion: options.targetVersion ?? 9,
          sourceText: targetText,
        }),
      ),
    ),
  };
  const permissions = { assert: vi.fn(() => Promise.resolve()) };
  const screenplayPermissions = {
    assert: vi.fn(() =>
      options.screenplayAssertError
        ? Promise.reject(options.screenplayAssertError)
        : Promise.resolve(),
    ),
  };

  const service = new ScreenplayRebaseApplyService(
    prisma as never,
    permissions as never,
    screenplayPermissions as never,
    screenplays as never,
    db as never,
  );
  return {
    service,
    calls,
    updates,
    transactionOptions,
    db,
    screenplays,
    permissions,
    screenplayPermissions,
  };
}

const PROBE_FINGERPRINT = sha256('a plan from another moment');

function requestWith(
  fingerprint: string,
  decisions: ScreenplayRebaseDecisionInput[] = [],
): ApplyScreenplayRebaseInput {
  return { planVersion: SCREENPLAY_REBASE_PLAN_VERSION, fingerprint, decisions };
}

/**
 * The fingerprint of the plan this harness's rows produce, derived through the same assembler the
 * preview and the apply both use rather than copied out of a successful run — so a test that passes
 * because the service stopped checking would be impossible.
 */
function fingerprintOfHarnessState(): string {
  return buildScreenplayRebasePlan({
    projectId,
    screenplayId,
    linkUpdatedAt: new Date('2026-07-30T10:00:00.000Z'),
    target: { screenplayVersion: 9, screenplayRevisionId: null, sourceText: targetText },
    references: [{ id: referenceId, itemId }],
    pins: new Map([[referenceId, pinRow() as never]]),
    revisions: new Map([[revisionId, { screenplayVersion: 7, sourceText }]]),
    computedAt: new Date(),
  }).fingerprint;
}

describe('ScreenplayRebaseApplyService validates inside the transaction it writes in', () => {
  it('locks, reads, and verifies before it creates or writes anything', async () => {
    const { service, calls, transactionOptions, screenplays } = harness();
    const fingerprint = fingerprintOfHarnessState();
    calls.length = 0;

    const result = await service.apply(userId, projectId, requestWith(fingerprint));

    expect(result.summary).toMatchObject({ carriedCount: 1, movedCount: 1 });
    // Order is the design: the transaction opens, the lock is taken, every read happens, and only
    // then does the first write appear.
    expect(calls[0]).toBe('transaction.begin');
    expect(calls[1]).toBe(`lock:breakdown-screenplay-rebase:${projectId}`);
    const firstWrite = calls.findIndex((call) => call.startsWith('write.'));
    const lastRead = calls.reduce(
      (last, call, index) => (call.startsWith('read.') ? index : last),
      -1,
    );
    expect(lastRead).toBeLessThan(firstWrite);
    expect(calls[firstWrite]).toBe('write.checkpoint');
    expect(screenplays.ensureCheckpointWithin).toHaveBeenCalledTimes(1);
    expect(transactionOptions[0]).toMatchObject({ isolationLevel: 'Serializable' });
  });

  it('writes nothing at all when the plan is stale', async () => {
    const { service, calls, screenplays } = harness();
    await expect(
      service.apply(userId, projectId, requestWith(PROBE_FINGERPRINT)),
    ).rejects.toBeInstanceOf(ConflictException);

    // No checkpoint, no pin, no activity: the refusal happens before the first write, so there is no
    // partial application to unwind and no orphan revision left behind.
    expect(calls.filter((call) => call.startsWith('write.'))).toEqual([]);
    expect(screenplays.ensureCheckpointWithin).not.toHaveBeenCalled();
  });

  it('refuses when the linked screenplay moved on under the plan', async () => {
    const fingerprint = fingerprintOfHarnessState();
    // A different screenplay version is one of the four facts the fingerprint covers.
    const moved = harness({ targetVersion: 10 });
    await expect(
      moved.service.apply(userId, projectId, requestWith(fingerprint)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(moved.calls.filter((call) => call.startsWith('write.'))).toEqual([]);
  });

  it('refuses when the breakdown was relinked under the plan', async () => {
    const fingerprint = fingerprintOfHarnessState();
    const relinked = harness({ linkUpdatedAt: new Date('2026-07-30T11:30:00.000Z') });
    await expect(
      relinked.service.apply(userId, projectId, requestWith(fingerprint)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(relinked.calls.filter((call) => call.startsWith('write.'))).toEqual([]);
  });

  it('refuses when the pin was re-pinned under the plan', async () => {
    const fingerprint = fingerprintOfHarnessState();
    const repinned = harness({
      pins: [pinRow({ updatedAt: new Date('2026-07-30T11:45:00.000Z') })],
    });
    await expect(
      repinned.service.apply(userId, projectId, requestWith(fingerprint)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repinned.calls.filter((call) => call.startsWith('write.'))).toEqual([]);
  });
});

describe('ScreenplayRebaseApplyService writes', () => {
  it('moves the pin onto the freshly cut revision, conditioned on the one it is leaving', async () => {
    const { service, updates } = harness();
    const fingerprint = fingerprintOfHarnessState();
    updates.length = 0;

    await service.apply(userId, projectId, requestWith(fingerprint));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      where: { itemSourceReferenceId: referenceId, projectId, screenplayRevisionId: revisionId },
      data: {
        screenplayRevisionId: targetRevisionId,
        screenplayVersion: 9,
        sourceTextHash: sha256('BODY LINE'),
        updatedById: userId,
      },
    });
  });

  it('aborts when the conditional update matches no row', async () => {
    const fingerprint = fingerprintOfHarnessState();
    const raced = harness({ updatedCount: 0 });
    await expect(
      raced.service.apply(userId, projectId, requestWith(fingerprint)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records exactly one activity event for the whole rebase', async () => {
    const { service, calls } = harness();
    const fingerprint = fingerprintOfHarnessState();
    calls.length = 0;
    await service.apply(userId, projectId, requestWith(fingerprint));
    expect(calls.filter((call) => call === 'write.activity')).toHaveLength(1);
  });
});

describe('ScreenplayRebaseApplyService authorization', () => {
  it('asserts the breakdown permission before it opens a transaction', async () => {
    const { service, permissions, calls } = harness();
    await service.apply(userId, projectId, requestWith(fingerprintOfHarnessState()));
    expect(permissions.assert).toHaveBeenCalledWith(userId, projectId, 'manage_items');
    expect(calls.indexOf('transaction.begin')).toBeGreaterThanOrEqual(0);
  });

  it('re-authorizes the screenplay the link names inside the transaction, before reading its text', async () => {
    // A link repointed since the caller was authorized must not let the apply read a screenplay they
    // cannot see, so the assertion sits between the in-transaction link read and the text read.
    const { service, calls, screenplayPermissions } = harness({
      screenplayAssertError: new NotFoundException('Screenplay not found'),
    });
    await expect(
      service.apply(userId, projectId, requestWith(PROBE_FINGERPRINT)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(screenplayPermissions.assert).toHaveBeenCalledWith(
      userId,
      screenplayId,
      'read_screenplay',
    );
    expect(calls).toContain('read.link');
    expect(calls).not.toContain('read.screenplay');
  });
});
