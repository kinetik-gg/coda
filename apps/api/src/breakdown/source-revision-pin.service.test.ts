import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SourceRevisionPinService } from './source-revision-pin.service';
import { sourceTextHash } from './source-revision-pin';

const projectId = '40000000-0000-4000-8000-000000000001';
const userId = '40000000-0000-4000-8000-000000000002';
const itemId = '40000000-0000-4000-8000-000000000003';
const referenceId = '40000000-0000-4000-8000-000000000004';
const screenplayId = '40000000-0000-4000-8000-000000000005';
const revisionId = '40000000-0000-4000-8000-000000000006';

const createdAt = new Date('2026-07-30T10:00:00.000Z');
const source = 'INT. DINER - NIGHT\n\nMAYA sets down the envelope.\n';
const range = { start: 20, end: 48 };
const excerpt = 'MAYA sets down the envelope.';

function referenceRow() {
  return {
    id: referenceId,
    itemId,
    sourceDocumentId: '40000000-0000-4000-8000-000000000007',
    startPage: 4,
    endPage: 9,
    position: 'b',
  };
}

function pinRow(overrides: Record<string, unknown> = {}) {
  return {
    itemSourceReferenceId: referenceId,
    projectId,
    itemId,
    screenplayId,
    screenplayRevisionId: revisionId,
    screenplayVersion: 7,
    sourceStart: range.start,
    sourceEnd: range.end,
    sourceTextHash: sourceTextHash(excerpt),
    createdById: userId,
    updatedById: userId,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

interface HarnessOptions {
  reference?: unknown;
  link?: unknown;
  pin?: unknown;
  revision?: unknown;
  checkpoint?: unknown;
  checkpointError?: unknown;
  screenplayAssertError?: unknown;
}

function harness(options: HarnessOptions = {}) {
  const pin = {
    findUnique: vi.fn().mockResolvedValue('pin' in options ? options.pin : null),
    upsert: vi.fn().mockResolvedValue(pinRow()),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const activityEvent = { create: vi.fn().mockResolvedValue({}) };
  const referenceFindFirst = vi
    .fn()
    .mockResolvedValue('reference' in options ? options.reference : referenceRow());
  const linkFindUnique = vi
    .fn()
    .mockResolvedValue('link' in options ? options.link : { screenplayId });
  const revisionFindFirst = vi
    .fn()
    .mockResolvedValue('revision' in options ? options.revision : { sourceText: source });
  const tx = { itemSourceRevisionPin: pin, activityEvent };
  const prisma = {
    itemSourceRevisionPin: pin,
    itemSourceReference: { findFirst: referenceFindFirst },
    breakdownScreenplayLink: { findUnique: linkFindUnique },
    screenplayRevision: { findFirst: revisionFindFirst },
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const projectAssert = vi.fn().mockResolvedValue({});
  const screenplayAssert = vi.fn();
  if (options.screenplayAssertError)
    screenplayAssert.mockRejectedValue(options.screenplayAssertError);
  else screenplayAssert.mockResolvedValue({});
  const ensureCheckpoint = vi.fn();
  if (options.checkpointError) ensureCheckpoint.mockRejectedValue(options.checkpointError);
  else {
    ensureCheckpoint.mockResolvedValue(
      'checkpoint' in options
        ? options.checkpoint
        : { id: revisionId, screenplayVersion: 7, sourceText: source },
    );
  }
  return {
    pin,
    activityEvent,
    referenceFindFirst,
    linkFindUnique,
    revisionFindFirst,
    projectAssert,
    screenplayAssert,
    ensureCheckpoint,
    service: new SourceRevisionPinService(
      prisma as never,
      { assert: projectAssert } as never,
      { assert: screenplayAssert } as never,
      { ensureCheckpoint } as never,
    ),
  };
}

describe('SourceRevisionPinService.get', () => {
  it('reports an unpinned legacy reference without touching the screenplay graph', async () => {
    const context = harness();

    const resolved = await context.service.get(userId, projectId, itemId, referenceId);

    expect(resolved.resolution).toBe('unpinned');
    expect(resolved.startPage).toBe(4);
    expect(context.projectAssert).toHaveBeenCalledWith(userId, projectId, 'read_project');
    expect(context.screenplayAssert).not.toHaveBeenCalled();
    expect(context.revisionFindFirst).not.toHaveBeenCalled();
  });

  it('resolves a pinned reference out of the immutable revision', async () => {
    const context = harness({ pin: pinRow() });

    const resolved = await context.service.get(userId, projectId, itemId, referenceId);

    expect(resolved.resolution).toBe('pinned');
    expect(resolved.sourceText).toBe(excerpt);
    // The mutable `Screenplay.sourceText` is never queried on a read path.
    expect(context.revisionFindFirst).toHaveBeenCalledWith({
      where: {
        id: revisionId,
        screenplayId,
        screenplay: { deletedAt: null },
      },
      select: { sourceText: true },
    });
  });

  it('reports unavailable when the pinned revision has been purged away', async () => {
    const context = harness({ pin: pinRow(), revision: null });

    const resolved = await context.service.get(userId, projectId, itemId, referenceId);

    expect(resolved.resolution).toBe('unavailable');
    expect(resolved.sourceText).toBeNull();
    expect(resolved.endPage).toBe(9);
  });

  it('reports unavailable rather than leaking text when the caller cannot read the screenplay', async () => {
    const context = harness({
      pin: pinRow(),
      screenplayAssertError: new ForbiddenException('nope'),
    });

    const resolved = await context.service.get(userId, projectId, itemId, referenceId);

    expect(resolved.resolution).toBe('unavailable');
    expect(context.revisionFindFirst).not.toHaveBeenCalled();
  });

  it('rejects a reference that is not on an active item in this project', async () => {
    const context = harness({ reference: null });

    await expect(context.service.get(userId, projectId, itemId, referenceId)).rejects.toThrow(
      NotFoundException,
    );
    expect(context.referenceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: referenceId, itemId, item: { projectId, deletedAt: null } },
      }),
    );
  });
});

describe('SourceRevisionPinService.pin', () => {
  const input = { screenplayVersion: 7, source: range };

  it('checkpoints the linked screenplay and stores the range, hash, and version', async () => {
    const context = harness();

    const resolved = await context.service.pin(userId, projectId, itemId, referenceId, input);

    expect(context.ensureCheckpoint).toHaveBeenCalledWith(screenplayId, 7);
    const upsert = context.pin.upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(upsert.create).toMatchObject({
      itemSourceReferenceId: referenceId,
      projectId,
      itemId,
      screenplayId,
      screenplayRevisionId: revisionId,
      screenplayVersion: 7,
      sourceStart: 20,
      sourceEnd: 48,
      sourceTextHash: sourceTextHash(excerpt),
    });
    expect(resolved.resolution).toBe('pinned');
    expect(resolved.sourceText).toBe(excerpt);
  });

  it('never writes the source reference itself, so PDF resolution is untouched', async () => {
    const context = harness();

    const resolved = await context.service.pin(userId, projectId, itemId, referenceId, input);

    expect(resolved.sourceDocumentId).toBe(referenceRow().sourceDocumentId);
    expect(resolved.startPage).toBe(4);
    expect(resolved.endPage).toBe(9);
  });

  it('asserts the breakdown permission before it looks at the screenplay at all', async () => {
    const context = harness();
    const order: string[] = [];
    context.projectAssert.mockImplementation(() => {
      order.push('project');
      return Promise.resolve({});
    });
    context.screenplayAssert.mockImplementation(() => {
      order.push('screenplay');
      return Promise.resolve({});
    });

    await context.service.pin(userId, projectId, itemId, referenceId, input);

    expect(order).toEqual(['project', 'screenplay']);
    expect(context.projectAssert).toHaveBeenCalledWith(userId, projectId, 'manage_items');
    expect(context.screenplayAssert).toHaveBeenCalledWith(userId, screenplayId, 'read_screenplay');
  });

  it('refuses to pin a breakdown that follows no screenplay', async () => {
    const context = harness({ link: null });

    await expect(
      context.service.pin(userId, projectId, itemId, referenceId, input),
    ).rejects.toThrow(NotFoundException);
    expect(context.ensureCheckpoint).not.toHaveBeenCalled();
    expect(context.pin.upsert).not.toHaveBeenCalled();
  });

  it('propagates a stale-version conflict from the checkpoint instead of pinning', async () => {
    const context = harness({
      checkpointError: new ConflictException('Screenplay was modified by another session'),
    });

    await expect(
      context.service.pin(userId, projectId, itemId, referenceId, input),
    ).rejects.toThrow(ConflictException);
    expect(context.pin.upsert).not.toHaveBeenCalled();
  });

  it('rejects a range that runs past the revision it would be pinned to', async () => {
    const context = harness();

    await expect(
      context.service.pin(userId, projectId, itemId, referenceId, {
        screenplayVersion: 7,
        source: { start: 0, end: source.length + 5 },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(context.pin.upsert).not.toHaveBeenCalled();
  });

  it('records the pin as an activity event on the breakdown', async () => {
    const context = harness();

    await context.service.pin(userId, projectId, itemId, referenceId, input);

    const event = context.activityEvent.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(event.data).toMatchObject({
      projectId,
      actorId: userId,
      action: 'UPDATED',
      resourceType: 'item_source_revision_pin',
      resourceId: referenceId,
    });
    expect(event.data.metadata).toMatchObject({
      screenplayId,
      screenplayRevisionId: revisionId,
      screenplayVersion: 7,
      sourceStart: 20,
      sourceEnd: 48,
    });
  });
});

describe('SourceRevisionPinService.unpin', () => {
  it('returns the reference to legacy PDF resolution', async () => {
    const context = harness({ pin: pinRow() });

    const resolved = await context.service.unpin(userId, projectId, itemId, referenceId);

    expect(context.pin.deleteMany).toHaveBeenCalledWith({
      where: { itemSourceReferenceId: referenceId },
    });
    expect(resolved).toEqual({
      id: referenceId,
      itemId,
      sourceDocumentId: referenceRow().sourceDocumentId,
      startPage: 4,
      endPage: 9,
      position: 'b',
      resolution: 'unpinned',
      pin: null,
      sourceText: null,
    });
  });

  it('needs no screenplay access, so a pin to an unreachable screenplay stays clearable', async () => {
    const context = harness({
      pin: pinRow(),
      screenplayAssertError: new ForbiddenException('nope'),
    });

    await expect(
      context.service.unpin(userId, projectId, itemId, referenceId),
    ).resolves.toMatchObject({ resolution: 'unpinned' });
    expect(context.screenplayAssert).not.toHaveBeenCalled();
  });

  it('is idempotent and records nothing when there was no pin', async () => {
    const context = harness();
    context.pin.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      context.service.unpin(userId, projectId, itemId, referenceId),
    ).resolves.toMatchObject({ resolution: 'unpinned' });
    expect(context.activityEvent.create).not.toHaveBeenCalled();
  });
});
