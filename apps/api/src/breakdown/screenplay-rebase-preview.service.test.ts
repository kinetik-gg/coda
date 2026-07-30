import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayRebasePreviewService } from './screenplay-rebase-preview.service';

const projectId = '00000000-0000-4000-8000-000000000001';
const screenplayId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-0000000000e1';

const sourceText = 'INT. OFFICE - DAY\n\nMAYA\nNot again.\n\nBODY LINE';
const targetText = `FADE IN:\n\n${sourceText}`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pinRow(overrides: Record<string, unknown> = {}) {
  const start = sourceText.indexOf('BODY LINE');
  return {
    itemSourceReferenceId: 'ref-1',
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

/**
 * A Prisma double that answers reads and **throws on everything else**.
 *
 * This is the mechanical guarantee behind #242's "opening and completing the preview performs zero
 * writes": no method is stubbed permissively, so reaching for `create`, `update`, `upsert`,
 * `delete`, `$transaction`, or any raw execution is not merely unasserted — it fails the test with
 * the name of the method that was called. A future edit that starts writing here cannot pass.
 */
function prismaDouble(reads: Record<string, Record<string, unknown>>) {
  const calls: string[] = [];
  const model = (name: string, methods: Record<string, unknown>) =>
    new Proxy(
      {},
      {
        get(_target, property: string) {
          const method = methods[property];
          if (!method) {
            throw new Error(`The rebase preview must not call prisma.${name}.${property}`);
          }
          calls.push(`${name}.${property}`);
          return method;
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get(_target, property: string) {
        const methods = reads[property];
        if (!methods) throw new Error(`The rebase preview must not use prisma.${property}`);
        return model(property, methods);
      },
    },
  );
  return { prisma, calls };
}

interface HarnessOptions {
  link?: { screenplayId: string; updatedAt: Date } | null;
  screenplay?: { version: number; sourceText: string } | null;
  references?: { id: string; itemId: string }[];
  pins?: Record<string, unknown>[];
  revisions?: { id: string; screenplayVersion: number; sourceText: string }[];
  targetRevision?: { id: string } | null;
  permissionError?: Error;
  screenplayAssertError?: Error;
}

function harness(options: HarnessOptions = {}) {
  const revisionFindMany = vi.fn(() => Promise.resolve(options.revisions ?? []));
  const { prisma, calls } = prismaDouble({
    breakdownScreenplayLink: {
      findUnique: () =>
        Promise.resolve(
          options.link === undefined
            ? { screenplayId, updatedAt: new Date('2026-07-30T10:00:00.000Z') }
            : options.link,
        ),
    },
    screenplay: {
      findFirst: () =>
        Promise.resolve(
          options.screenplay === undefined
            ? { version: 9, sourceText: targetText }
            : options.screenplay,
        ),
    },
    itemSourceReference: {
      findMany: () => Promise.resolve(options.references ?? [{ id: 'ref-1', itemId: 'item-1' }]),
    },
    itemSourceRevisionPin: {
      findMany: () => Promise.resolve(options.pins ?? [pinRow()]),
    },
    screenplayRevision: {
      findMany: revisionFindMany,
      findUnique: () => Promise.resolve(options.targetRevision ?? null),
    },
  });
  const permissions = {
    assert: vi.fn(() =>
      options.permissionError ? Promise.reject(options.permissionError) : Promise.resolve(),
    ),
  };
  const screenplayPermissions = {
    assert: vi.fn(() =>
      options.screenplayAssertError
        ? Promise.reject(options.screenplayAssertError)
        : Promise.resolve(),
    ),
  };
  const service = new ScreenplayRebasePreviewService(
    prisma as never,
    permissions as never,
    screenplayPermissions as never,
  );
  return { service, permissions, screenplayPermissions, calls, revisionFindMany };
}

const defaultRevisions = [{ id: revisionId, screenplayVersion: 7, sourceText }];

describe('ScreenplayRebasePreviewService writes nothing', () => {
  it('produces a whole plan touching only read methods', async () => {
    const { service, calls } = harness({ revisions: defaultRevisions });
    const plan = await service.preview(userId, projectId);

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.classification).toBe('shifted-with-identical-text');
    // Every Prisma call the preview made, and every one of them is a read.
    expect(calls).toEqual([
      'breakdownScreenplayLink.findUnique',
      'screenplay.findFirst',
      'itemSourceReference.findMany',
      'itemSourceRevisionPin.findMany',
      'screenplayRevision.findMany',
      'screenplayRevision.findUnique',
    ]);
    expect(calls.every((call) => /\.find(Unique|First|Many)$/.test(call))).toBe(true);
  });

  it('never cuts a revision for the version it previews against', async () => {
    const { service } = harness({ revisions: defaultRevisions });
    const plan = await service.preview(userId, projectId);
    // `ensureCheckpoint` is the write the pin flow performs; the preview reports `null` instead. The
    // service does not even receive `ScreenplaysService`, so there is nothing here that could cut one.
    expect(plan.target.screenplayRevisionId).toBeNull();
    expect(plan.target.screenplayVersion).toBe(9);
    expect(ScreenplayRebasePreviewService.length).toBe(3);
  });

  it('reuses an existing revision for the target version without creating one', async () => {
    const { service } = harness({
      revisions: defaultRevisions,
      targetRevision: { id: 'cut-already' },
    });
    expect((await service.preview(userId, projectId)).target.screenplayRevisionId).toBe(
      'cut-already',
    );
  });

  it('records no activity event', async () => {
    // `activityEvent` is not in the double at all, so any attempt to log would throw by name.
    const { service } = harness({ revisions: defaultRevisions });
    await expect(service.preview(userId, projectId)).resolves.toBeDefined();
  });

  it('keeps every mutating verb out of the preview source', () => {
    // A source gate rather than a behavioural one, because a write on a path the tests above do not
    // happen to exercise would still be a write. Read together with the Prisma double, this covers
    // both "does not write" and "cannot start writing without someone noticing".
    // `<client>.<model>.<verb>(` — the shape every Prisma write takes, so `createHash().update()` is
    // not mistaken for one while `tx.itemSourceRevisionPin.upsert(` still is.
    const forbidden =
      /\b\w+\.\w+\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw|ensureCheckpoint/;
    for (const file of ['screenplay-rebase-preview.service.ts', 'screenplay-rebase-plan.ts']) {
      // Comments are stripped first: both files explain in prose exactly which writes they avoid,
      // and the gate is about what the module executes, not about what it documents.
      const code = readFileSync(join(__dirname, file), 'utf8')
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(forbidden);
    }
    // And the gate is not vacuous: the pin service next door really does write, and trips it.
    expect(readFileSync(join(__dirname, 'source-revision-pin.service.ts'), 'utf8')).toMatch(
      forbidden,
    );
  });
});

describe('ScreenplayRebasePreviewService authorization and preconditions', () => {
  it('asserts the breakdown permission before it reveals the linked screenplay', async () => {
    const { service, permissions, screenplayPermissions } = harness({
      permissionError: new NotFoundException('Project not found'),
    });
    await expect(service.preview(userId, projectId)).rejects.toBeInstanceOf(NotFoundException);
    expect(permissions.assert).toHaveBeenCalledWith(userId, projectId, 'manage_items');
    // A caller who cannot see the breakdown learns nothing about the screenplay it follows.
    expect(screenplayPermissions.assert).not.toHaveBeenCalled();
  });

  it('requires read access to the screenplay itself', async () => {
    const { service, screenplayPermissions } = harness({
      screenplayAssertError: new NotFoundException('Screenplay not found'),
    });
    await expect(service.preview(userId, projectId)).rejects.toBeInstanceOf(NotFoundException);
    expect(screenplayPermissions.assert).toHaveBeenCalledWith(
      userId,
      screenplayId,
      'read_screenplay',
    );
  });

  it('refuses to preview a breakdown that follows no screenplay', async () => {
    const { service } = harness({ link: null });
    await expect(service.preview(userId, projectId)).rejects.toThrow(
      'Link a screenplay to this breakdown before previewing a rebase',
    );
  });

  it('refuses to preview a screenplay that is gone or trashed', async () => {
    const { service } = harness({ screenplay: null });
    await expect(service.preview(userId, projectId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a plan request for a version the screenplay has already moved past', async () => {
    const { service } = harness({ revisions: defaultRevisions });
    // Returning a plan against text the reviewer never read would be worse than an error.
    await expect(service.preview(userId, projectId, 8)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.preview(userId, projectId, 9)).resolves.toBeDefined();
  });
});

describe('ScreenplayRebasePreviewService query shape', () => {
  it('loads revisions once for the distinct ids, never once per reference', async () => {
    const pins = Array.from({ length: 5 }, (_unused, index) =>
      pinRow({ itemSourceReferenceId: `ref-${index}` }),
    );
    const { service, revisionFindMany } = harness({
      references: pins.map((pin) => ({ id: pin.itemSourceReferenceId, itemId: 'item-1' })),
      pins,
      revisions: defaultRevisions,
    });
    const plan = await service.preview(userId, projectId);
    expect(plan.entries).toHaveLength(5);
    expect(revisionFindMany).toHaveBeenCalledTimes(1);
    expect(revisionFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: [revisionId] } },
    });
  });

  it('reports a reference with no pin as unpinned rather than as a decision', async () => {
    const { service } = harness({
      references: [
        { id: 'ref-1', itemId: 'item-1' },
        { id: 'ref-2', itemId: 'item-1' },
      ],
      revisions: defaultRevisions,
    });
    const plan = await service.preview(userId, projectId);
    expect(plan.excluded).toEqual([
      { itemSourceReferenceId: 'ref-2', itemId: 'item-1', reason: 'unpinned' },
    ]);
    expect(plan.summary.decisionCount).toBe(0);
  });

  it('reports a pin whose revision is gone as unavailable, not as stale', async () => {
    const { service } = harness({ revisions: [] });
    const plan = await service.preview(userId, projectId);
    expect(plan.entries).toEqual([]);
    expect(plan.excluded[0]?.reason).toBe('pin-unavailable');
  });
});
