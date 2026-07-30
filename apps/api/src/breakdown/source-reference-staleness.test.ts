import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { sourceTextHash } from './source-revision-pin';
import { SourceReferenceStalenessService, summarizePin } from './source-reference-staleness';

const userId = '50000000-0000-4000-8000-000000000001';
const referenceIdA = '50000000-0000-4000-8000-000000000002';
const referenceIdB = '50000000-0000-4000-8000-000000000003';
const screenplayIdA = '50000000-0000-4000-8000-000000000004';
const screenplayIdB = '50000000-0000-4000-8000-000000000005';
const revisionIdA = '50000000-0000-4000-8000-000000000006';
const revisionIdB = '50000000-0000-4000-8000-000000000007';

const createdAt = new Date('2026-07-30T10:00:00.000Z');

function pinRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    itemSourceReferenceId: referenceIdA,
    screenplayId: screenplayIdA,
    screenplayRevisionId: revisionIdA,
    screenplayVersion: 7,
    sourceStart: 0,
    sourceEnd: 4,
    sourceTextHash: sourceTextHash('quip'),
    createdById: userId,
    updatedById: userId,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('summarizePin', () => {
  it('reports current when the live version matches the pinned one', () => {
    const summary = summarizePin(
      pinRow({ screenplayVersion: 7 }),
      new Map([[screenplayIdA, 7]]),
      new Set([revisionIdA]),
    );
    expect(summary.resolution).toBe('pinned');
    expect(summary.staleness).toBe('current');
    expect(summary.pin?.screenplayId).toBe(screenplayIdA);
  });

  it('reports stale once the live version has advanced past the pinned one', () => {
    const summary = summarizePin(
      pinRow({ screenplayVersion: 7 }),
      new Map([[screenplayIdA, 9]]),
      new Set([revisionIdA]),
    );
    expect(summary.resolution).toBe('pinned');
    expect(summary.staleness).toBe('stale');
  });

  it('reports unavailable — with no staleness — when the screenplay is not in the live map', () => {
    const summary = summarizePin(pinRow(), new Map(), new Set([revisionIdA]));
    expect(summary.resolution).toBe('unavailable');
    expect(summary.staleness).toBeNull();
    // The pin itself still rides along so a caller can offer to clear or re-pin it.
    expect(summary.pin?.screenplayRevisionId).toBe(revisionIdA);
  });

  it('reports unavailable when the revision row is gone even though the screenplay is readable', () => {
    const summary = summarizePin(pinRow(), new Map([[screenplayIdA, 7]]), new Set());
    expect(summary.resolution).toBe('unavailable');
    expect(summary.staleness).toBeNull();
  });
});

interface HarnessOptions {
  pins?: unknown;
  screenplays?: unknown;
  revisions?: unknown;
  screenplayAssert?: ReturnType<typeof vi.fn>;
}

function harness(options: HarnessOptions = {}) {
  const pinFindMany = vi.fn().mockResolvedValue(options.pins ?? []);
  const screenplayFindMany = vi.fn().mockResolvedValue(options.screenplays ?? []);
  const revisionFindMany = vi.fn().mockResolvedValue(options.revisions ?? []);
  const screenplayAssert = options.screenplayAssert ?? vi.fn().mockResolvedValue({});
  const prisma = {
    itemSourceRevisionPin: { findMany: pinFindMany },
    screenplay: { findMany: screenplayFindMany },
    screenplayRevision: { findMany: revisionFindMany },
  };
  return {
    pinFindMany,
    screenplayFindMany,
    revisionFindMany,
    screenplayAssert,
    service: new SourceReferenceStalenessService(
      prisma as never,
      { assert: screenplayAssert } as never,
    ),
  };
}

describe('SourceReferenceStalenessService.summaries', () => {
  it('issues no queries for an empty reference list', async () => {
    const context = harness();

    await expect(context.service.summaries(userId, [])).resolves.toEqual(new Map());
    expect(context.pinFindMany).not.toHaveBeenCalled();
  });

  it('issues no follow-up queries when none of the references are pinned', async () => {
    const context = harness({ pins: [] });

    await expect(context.service.summaries(userId, [referenceIdA])).resolves.toEqual(new Map());
    expect(context.screenplayFindMany).not.toHaveBeenCalled();
    expect(context.revisionFindMany).not.toHaveBeenCalled();
  });

  it('resolves many pinned references against one screenplay with a bounded query count', async () => {
    const pins = [
      pinRow({ itemSourceReferenceId: referenceIdA, screenplayVersion: 7 }),
      pinRow({
        itemSourceReferenceId: referenceIdB,
        screenplayId: screenplayIdA,
        screenplayRevisionId: revisionIdA,
        screenplayVersion: 3,
      }),
    ];
    const context = harness({
      pins,
      screenplays: [{ id: screenplayIdA, version: 9 }],
      revisions: [{ id: revisionIdA }],
    });

    const summaries = await context.service.summaries(userId, [referenceIdA, referenceIdB]);

    expect(summaries.get(referenceIdA)).toMatchObject({ resolution: 'pinned', staleness: 'stale' });
    expect(summaries.get(referenceIdB)).toMatchObject({ resolution: 'pinned', staleness: 'stale' });
    // One distinct screenplay across a hundred references would still be one permission check and
    // one screenplay lookup — never a query per reference.
    expect(context.screenplayAssert).toHaveBeenCalledTimes(1);
    expect(context.screenplayFindMany).toHaveBeenCalledTimes(1);
    expect(context.revisionFindMany).toHaveBeenCalledTimes(1);
  });

  it('marks a pin unavailable when its screenplay is trashed, purged, or unreadable', async () => {
    const context = harness({
      pins: [pinRow()],
      screenplays: [],
      screenplayAssert: vi.fn().mockRejectedValue(new NotFoundException('gone')),
    });

    const summaries = await context.service.summaries(userId, [referenceIdA]);

    expect(summaries.get(referenceIdA)).toMatchObject({
      resolution: 'unavailable',
      staleness: null,
    });
    expect(context.screenplayFindMany).not.toHaveBeenCalled();
  });

  it('propagates an unexpected permission error instead of silently reporting unavailable', async () => {
    const context = harness({
      pins: [pinRow()],
      screenplayAssert: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(context.service.summaries(userId, [referenceIdA])).rejects.toThrow('boom');
  });

  it('checks each distinct screenplay across pins that target more than one', async () => {
    const pins = [
      pinRow({ itemSourceReferenceId: referenceIdA, screenplayId: screenplayIdA }),
      pinRow({
        itemSourceReferenceId: referenceIdB,
        screenplayId: screenplayIdB,
        screenplayRevisionId: revisionIdB,
      }),
    ];
    const context = harness({
      pins,
      screenplays: [
        { id: screenplayIdA, version: 7 },
        { id: screenplayIdB, version: 8 },
      ],
      revisions: [{ id: revisionIdA }, { id: revisionIdB }],
    });

    const summaries = await context.service.summaries(userId, [referenceIdA, referenceIdB]);

    expect(summaries.get(referenceIdA)).toMatchObject({ staleness: 'current' });
    expect(summaries.get(referenceIdB)).toMatchObject({ staleness: 'stale' });
    expect(context.screenplayAssert).toHaveBeenCalledTimes(2);
  });

  it('rejects a Forbidden screenplay the same way as a missing one', async () => {
    const context = harness({
      pins: [pinRow()],
      screenplayAssert: vi.fn().mockRejectedValue(new ForbiddenException('nope')),
    });

    const summaries = await context.service.summaries(userId, [referenceIdA]);

    expect(summaries.get(referenceIdA)).toMatchObject({ resolution: 'unavailable' });
  });
});
