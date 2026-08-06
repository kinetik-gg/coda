import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { allScreenplayPermissions } from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SPACE_ID } from '../spaces/space-constants';
import { ScreenplaysService } from './screenplays.service';
import { ScreenplaySpacesService } from './screenplay-spaces.service';

const GOVERNED_SPACE_ID = '00000000-0000-4000-8000-000000000003';

function screenplay(overrides: Record<string, unknown> = {}) {
  return {
    id: 'screenplay-id',
    ownerUserId: 'owner-id',
    title: 'Pilot',
    filename: 'pilot.fountain',
    sourceText: 'Title: Pilot\n',
    paperSize: 'letter',
    version: 1,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-id',
    roleId: 'role-id',
    role: {
      archivedAt: null,
      isOwner: true,
      permissions: allScreenplayPermissions.map((permission) => ({ permission })),
    },
    screenplay: { ownerUserId: 'owner-id' },
    ...overrides,
  };
}

// A permissive permission double: every screenplay endpoint is authorised. Tenant isolation and the
// role matrix are covered by the permission service unit tests and the integration suite; these
// tests exercise the quota/versioning/checkpoint mechanics behind the guard.
function allowingPermissions() {
  return {
    assert: vi.fn().mockResolvedValue(membership()),
    membership: vi.fn().mockResolvedValue(membership()),
  };
}

function missingRecordError() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '6.19.3',
  });
}

function writeConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Write conflict', {
    code: 'P2034',
    clientVersion: '6.19.3',
  });
}

const limits = {
  maxDocumentsPerOwner: 250,
  maxSourceBytesPerOwner: 262_144_000,
  maxCheckpointsPerScreenplay: 100,
  maxCheckpointBytesPerOwner: 262_144_000,
};

function service(
  prisma: object,
  permissions: object = allowingPermissions(),
  spaceResources?: object,
  spaceCreation: object = { authorizeTarget: vi.fn().mockResolvedValue(DEFAULT_SPACE_ID) },
  collabSource: object = noCollaborativeDocument(),
) {
  return new ScreenplaysService(
    prisma as never,
    limits,
    permissions as never,
    new ScreenplaySpacesService(spaceCreation as never, spaceResources as never),
    collabSource as never,
  );
}

/** The default: nobody has opened this screenplay, so `Screenplay.sourceText` is the only copy. */
function noCollaborativeDocument() {
  return {
    hasDocument: vi.fn().mockResolvedValue(false),
    applySourceText: vi.fn().mockResolvedValue(undefined),
  };
}

/** A screenplay whose collaborative document exists and is therefore authoritative for its text. */
function liveCollaborativeDocument() {
  return {
    hasDocument: vi.fn().mockResolvedValue(true),
    applySourceText: vi.fn().mockResolvedValue(2),
  };
}

// Mocks for the seeded role graph provisioned inside the create/import transaction.
function provisioningMocks() {
  return {
    screenplayRole: { create: vi.fn().mockResolvedValue({ id: 'owner-role-id' }) },
    screenplayMembership: { create: vi.fn().mockResolvedValue({ id: 'membership-id' }) },
  };
}

function spaceResourceMocks() {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'mapping' }),
  };
}

describe('ScreenplaysService', () => {
  it('lists only screenplays the current user is a member of, without loading source text', async () => {
    const findMany = vi.fn().mockResolvedValue([screenplay()]);
    const membershipFindMany = vi.fn().mockResolvedValue([{ screenplayId: 'screenplay-id' }]);
    const target = service({
      screenplay: { findMany },
      screenplayMembership: { findMany: membershipFindMany },
    });

    await target.list('owner-id', { limit: 50 });

    expect(membershipFindMany).toHaveBeenCalledWith({
      where: { userId: 'owner-id' },
      select: { screenplayId: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['screenplay-id'] }, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        filename: true,
        paperSize: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('lists Space-only screenplays once and forwards the optional Space filter', async () => {
    const findMany = vi.fn((query: Prisma.ScreenplayFindManyArgs) => {
      void query;
      return Promise.resolve([screenplay({ id: 'space-only' })]);
    });
    const spaceResources = {
      listAccessibleResourceIds: vi.fn().mockResolvedValue(['direct', 'space-only']),
    };
    const target = service(
      {
        screenplay: { findMany },
        screenplayMembership: {
          findMany: vi.fn().mockResolvedValue([{ screenplayId: 'direct' }]),
        },
      },
      allowingPermissions(),
      spaceResources,
    );

    await expect(target.list('user', { limit: 50, spaceId: 'space' })).resolves.toEqual({
      data: [expect.objectContaining({ id: 'space-only' })],
      nextCursor: null,
    });
    expect(spaceResources.listAccessibleResourceIds).toHaveBeenCalledWith(
      'user',
      'screenplay',
      ['direct'],
      'space',
    );
    const listInput = findMany.mock.calls[0]![0];
    expect(listInput.where).toMatchObject({ id: { in: ['direct', 'space-only'] } });
  });

  it('creates a Fountain-backed screenplay and provisions its owner membership', async () => {
    const create = vi.fn().mockResolvedValue(screenplay());
    const provisioning = provisioningMocks();
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create,
      },
      spaceResource: spaceResourceMocks(),
      ...provisioning,
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.create('owner-id', { title: 'Pilot' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerUserId: 'owner-id',
          title: 'Pilot',
          filename: 'pilot.fountain',
          sourceText: '',
          sourceByteLength: 0,
          paperSize: 'letter',
        },
      }),
    );
    // The seeded roles (owner/admin/editor/viewer) and the owner membership are provisioned.
    expect(provisioning.screenplayRole.create).toHaveBeenCalledTimes(4);
    expect(provisioning.screenplayMembership.create).toHaveBeenCalledWith({
      data: { screenplayId: 'screenplay-id', userId: 'owner-id', roleId: 'owner-role-id' },
    });
  });

  it('refuses to create a screenplay in a Space that withholds create_resources', async () => {
    const create = vi.fn();
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create,
      },
      spaceResource: spaceResourceMocks(),
      ...provisioningMocks(),
    };
    const authorizeTarget = vi
      .fn()
      .mockRejectedValue(new ForbiddenException('Missing permission: create_resources'));
    const target = service(
      { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) },
      allowingPermissions(),
      undefined,
      { authorizeTarget },
    );

    await expect(
      target.create('owner-id', { title: 'Pilot', spaceId: GOVERNED_SPACE_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authorizeTarget).toHaveBeenCalledWith('owner-id', GOVERNED_SPACE_ID);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a screenplay created in a named Space into that Space', async () => {
    const spaceResource = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'mapping' }),
    };
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create: vi.fn().mockResolvedValue(screenplay()),
      },
      spaceResource,
      ...provisioningMocks(),
    };
    const target = service(
      { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) },
      allowingPermissions(),
      undefined,
      { authorizeTarget: vi.fn().mockResolvedValue(GOVERNED_SPACE_ID) },
    );

    await target.create('owner-id', { title: 'Pilot', spaceId: GOVERNED_SPACE_ID });

    const mapping = spaceResource.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(mapping.data).toMatchObject({
      spaceId: GOVERNED_SPACE_ID,
      resourceType: 'screenplay',
      resourceId: 'screenplay-id',
    });
  });

  it('imports Fountain losslessly and derives its title', async () => {
    const create = vi.fn().mockResolvedValue(screenplay());
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create,
      },
      spaceResource: spaceResourceMocks(),
      ...provisioningMocks(),
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });
    const sourceText = 'Title: Imported Pilot\r\n\r\nINT. ROOM - DAY\r\n';

    await target.import('owner-id', {
      filename: 'C:\\uploads\\draft.fountain',
      sourceText,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerUserId: 'owner-id',
          title: 'Imported Pilot',
          filename: 'draft.fountain',
          sourceText,
          sourceByteLength: Buffer.byteLength(sourceText, 'utf8'),
          paperSize: 'letter',
        },
      }),
    );
  });

  it('enforces document and aggregate UTF-8 byte quotas inside a serializable transaction', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(250),
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    };
    const transaction = vi.fn((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction: transaction });

    await expect(target.create('owner-id', { title: 'Over quota' })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(tx.screenplay.create).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects aggregate source bytes before creating a screenplay', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 262_144_000 } }),
        create: vi.fn(),
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await expect(
      target.create('owner-id', { title: 'Over bytes', sourceText: 'é' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(tx.screenplay.create).not.toHaveBeenCalled();
  });

  it('retries serializable quota checks after a concurrent write conflict', async () => {
    const tx = {
      screenplay: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        create: vi.fn().mockResolvedValue(screenplay()),
      },
      spaceResource: spaceResourceMocks(),
      ...provisioningMocks(),
    };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(writeConflictError())
      .mockImplementation((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction: transaction });

    await expect(target.create('owner-id', { title: 'Concurrent' })).resolves.toEqual(
      expect.objectContaining({ id: 'screenplay-id' }),
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('uses UTF-8 bytes when updating aggregate source storage', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ version: 2 }));
    const tx = {
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({ sourceByteLength: 1, ownerUserId: 'owner-id' }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 1 } }),
        update,
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await target.update('owner-id', 'screenplay-id', { sourceText: 'é', version: 1 });

    const updateInput = update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
    expect(updateInput?.data).toMatchObject({ sourceText: 'é', sourceByteLength: 2 });
    // The aggregate quota is scoped to the storage-partition owner, not the acting editor.
    expect(tx.screenplay.aggregate).toHaveBeenCalledWith({
      where: { ownerUserId: 'owner-id' },
      _sum: { sourceByteLength: true },
    });
  });

  it('paginates with a stable updatedAt and id ordering', async () => {
    const rows = [
      screenplay({ id: '00000000-0000-4000-8000-000000000002' }),
      screenplay({ id: '00000000-0000-4000-8000-000000000001' }),
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const target = service({
      screenplay: { findMany },
      screenplayMembership: {
        findMany: vi.fn().mockResolvedValue([{ screenplayId: 'screenplay-id' }]),
      },
    });

    const first = await target.list('owner-id', { limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    findMany.mockResolvedValue([]);
    await target.list('owner-id', { limit: 1, cursor: first.nextCursor! });
    const listInput = findMany.mock.calls.at(-1)?.[0] as
      { where: { OR?: unknown[] }; orderBy: unknown[] } | undefined;
    expect(listInput?.where.OR).toEqual(expect.any(Array));
    expect(listInput?.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
  });

  it('does not reveal a screenplay the user is not a member of', async () => {
    const permissions = {
      assert: vi.fn().mockRejectedValue(new NotFoundException('Screenplay not found')),
      membership: vi.fn(),
    };
    const target = service({ screenplay: { findUnique: vi.fn() } }, permissions);

    await expect(target.get('other-user', 'screenplay-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads a screenplay by id and surfaces the caller access once read is granted', async () => {
    const findFirst = vi.fn().mockResolvedValue(screenplay());
    const permissions = allowingPermissions();
    const target = service({ screenplay: { findFirst } }, permissions);

    const result = await target.get('owner-id', 'screenplay-id');

    expect(permissions.assert).toHaveBeenCalledWith('owner-id', 'screenplay-id', 'read_screenplay');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'screenplay-id', deletedAt: null } }),
    );
    // The detail read exposes the caller's role permissions so the editor can render read-only.
    expect(result.access.permissions).toContain('read_screenplay');
  });

  it('updates against the expected version and increments it atomically', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ title: 'Revised', version: 2 }));
    const permissions = allowingPermissions();
    const target = service({ screenplay: { update } }, permissions);

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'Revised', version: 1 }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Revised', version: 2 }));
    expect(permissions.assert).toHaveBeenCalledWith('owner-id', 'screenplay-id', 'edit_screenplay');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'screenplay-id', version: 1, deletedAt: null },
      data: { title: 'Revised', version: { increment: 1 } },
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        filename: true,
        paperSize: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        sourceText: true,
      },
    });
  });

  it('persists A4 as part of an optimistic screenplay update', async () => {
    const update = vi.fn().mockResolvedValue(screenplay({ paperSize: 'a4', version: 2 }));
    const target = service({ screenplay: { update } });

    await target.update('owner-id', 'screenplay-id', { paperSize: 'a4', version: 1 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paperSize: 'a4', version: { increment: 1 } },
      }),
    );
  });

  it('reports a stale version as a conflict', async () => {
    const target = service({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue({ id: 'screenplay-id' }),
      },
    });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports a vanished update target as not found', async () => {
    const target = service({
      screenplay: {
        update: vi.fn().mockRejectedValue(missingRecordError()),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not disguise database failures as version conflicts', async () => {
    const failure = new Error('database unavailable');
    const target = service({
      screenplay: { update: vi.fn().mockRejectedValue(failure) },
    });

    await expect(
      target.update('owner-id', 'screenplay-id', { title: 'changed', version: 1 }),
    ).rejects.toBe(failure);
  });
});

describe('ScreenplaysService checkpoints', () => {
  it('creates an exact export checkpoint attributed to the storage owner', async () => {
    const sourceText = 'Title: Café\r\n\r\nINT. ROOM - DAY\r\n';
    const checkpoint = {
      id: 'checkpoint-id',
      screenplayId: 'screenplay-id',
      screenplayVersion: 3,
      filename: 'café.fountain',
      paperSize: 'a4',
      sourceByteLength: Buffer.byteLength(sourceText, 'utf8'),
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
    };
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(checkpoint);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'screenplay-id',
          ownerUserId: 'owner-id',
          filename: 'café.fountain',
          paperSize: 'a4',
          sourceText,
          sourceByteLength: checkpoint.sourceByteLength,
          version: 3,
        }),
      },
      screenplayRevision: {
        findUnique,
        count: vi.fn().mockResolvedValue(2),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 100 } }),
        createMany,
      },
    };
    const transaction = vi.fn((callback: (value: typeof tx) => unknown) => callback(tx));
    const target = service({ $transaction: transaction });

    // `checkpoint` narrows the row to its metadata: the route reports that a snapshot exists, and
    // `GET /checkpoints/:id/export` is what hands the Fountain source back (issue #239).
    await expect(target.checkpoint('owner-id', 'screenplay-id', { version: 3 })).resolves.toEqual(
      checkpoint,
    );
    expect(tx.screenplay.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'screenplay-id', deletedAt: null } }),
    );
    expect(createMany).toHaveBeenCalledWith({
      data: {
        screenplayId: 'screenplay-id',
        ownerUserId: 'owner-id',
        screenplayVersion: 3,
        filename: 'café.fountain',
        paperSize: 'a4',
        sourceText,
        sourceByteLength: checkpoint.sourceByteLength,
      },
      skipDuplicates: true,
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('returns an existing version checkpoint idempotently before enforcing growth quotas', async () => {
    const existing = {
      id: 'checkpoint-id',
      screenplayId: 'screenplay-id',
      screenplayVersion: 2,
      filename: 'reused.fountain',
      paperSize: 'letter',
      sourceByteLength: 12,
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
      sourceText: 'INT. ROOM - DAY',
    };
    const tx = {
      screenplay: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner-id', version: 3 }) },
      screenplayRevision: {
        findUnique: vi.fn().mockResolvedValue(existing),
        count: vi.fn(),
        aggregate: vi.fn(),
        createMany: vi.fn(),
      },
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    // The reused row carries its Fountain source (revision pinning needs it), but the route's
    // response deliberately does not.
    const { sourceText, ...metadata } = existing;
    expect(sourceText).toBe('INT. ROOM - DAY');
    await expect(target.checkpoint('owner-id', 'screenplay-id', { version: 2 })).resolves.toEqual(
      metadata,
    );
    expect(tx.screenplayRevision.count).not.toHaveBeenCalled();
    expect(tx.screenplayRevision.createMany).not.toHaveBeenCalled();
  });

  it('rejects stale and vanished checkpoint targets without creating a revision', async () => {
    const revision = { findUnique: vi.fn().mockResolvedValue(null), createMany: vi.fn() };
    const staleTx = {
      screenplay: { findFirst: vi.fn().mockResolvedValue({ ownerUserId: 'owner-id', version: 4 }) },
      screenplayRevision: revision,
    };
    const stale = service({
      $transaction: vi.fn((callback: (value: typeof staleTx) => unknown) => callback(staleTx)),
    });
    await expect(
      stale.checkpoint('owner-id', 'screenplay-id', { version: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);

    const missingTx = {
      screenplay: { findFirst: vi.fn().mockResolvedValue(null) },
      screenplayRevision: revision,
    };
    const missing = service({
      $transaction: vi.fn((callback: (value: typeof missingTx) => unknown) => callback(missingTx)),
    });
    await expect(
      missing.checkpoint('owner-id', 'screenplay-id', { version: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(revision.createMany).not.toHaveBeenCalled();
  });

  it('bounds checkpoint count and aggregate owner bytes', async () => {
    const revision = {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(100),
      aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
      createMany: vi.fn(),
    };
    const tx = {
      screenplay: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ ownerUserId: 'owner-id', version: 1, sourceByteLength: 1 }),
      },
      screenplayRevision: revision,
    };
    const target = service({
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    });

    await expect(
      target.checkpoint('owner-id', 'screenplay-id', { version: 1 }),
    ).rejects.toBeInstanceOf(HttpException);

    revision.count.mockResolvedValue(0);
    revision.aggregate.mockResolvedValue({
      _sum: { sourceByteLength: limits.maxCheckpointBytesPerOwner },
    });
    await expect(
      target.checkpoint('owner-id', 'screenplay-id', { version: 1 }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(revision.createMany).not.toHaveBeenCalled();
  });

  it('reads a checkpoint export by screenplay and checkpoint once read is granted', async () => {
    const checkpoint = {
      id: 'checkpoint-id',
      screenplayId: 'screenplay-id',
      sourceText: 'Title: Exact\r\n',
    };
    const findFirst = vi.fn().mockResolvedValue(checkpoint);
    const permissions = allowingPermissions();
    const target = service({ screenplayRevision: { findFirst } }, permissions);

    await expect(
      target.getCheckpointExport('owner-id', 'screenplay-id', 'checkpoint-id'),
    ).resolves.toBe(checkpoint);
    expect(permissions.assert).toHaveBeenCalledWith('owner-id', 'screenplay-id', 'read_screenplay');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'checkpoint-id',
        screenplayId: 'screenplay-id',
        screenplay: { deletedAt: null },
      },
      select: {
        id: true,
        screenplayId: true,
        screenplayVersion: true,
        filename: true,
        paperSize: true,
        sourceByteLength: true,
        createdAt: true,
        sourceText: true,
      },
    });
  });
});

describe('ScreenplaysService source-of-truth routing', () => {
  // Issue #343. `Screenplay.sourceText` and the collaborative document are two representations of
  // one text; exactly one is authoritative at a time. Once a collaboration log exists, a REST write
  // that touched the row directly would leave the editor showing one text and statistics, outline
  // and exports another — the #336 shape.
  it('routes a sourceText write into the collaborative document when one exists', async () => {
    const update = vi.fn();
    const tx = {
      screenplay: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ sourceByteLength: 13, ownerUserId: 'owner-id', version: 1 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 13 } }),
        update,
      },
    };
    const projected = screenplay({ version: 2, sourceText: 'FADE IN:\n' });
    const collabSource = liveCollaborativeDocument();
    const target = service(
      {
        $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
        screenplay: { findFirst: vi.fn().mockResolvedValue(projected) },
      },
      allowingPermissions(),
      undefined,
      undefined,
      collabSource,
    );

    const result = await target.update('editor-id', 'screenplay-id', {
      sourceText: 'FADE IN:\n',
      version: 1,
    });

    expect(collabSource.applySourceText).toHaveBeenCalledWith(
      'screenplay-id',
      'editor-id',
      'FADE IN:\n',
    );
    // Nothing wrote the column directly; the projection derives it from the log this write appended
    // to, which is what makes the two impossible to disagree.
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual(projected);
  });

  it('refuses an over-quota collaborative sourceText write before anything reaches the log', async () => {
    const tx = {
      screenplay: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ sourceByteLength: 0, ownerUserId: 'owner-id', version: 1 }),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { sourceByteLength: limits.maxSourceBytesPerOwner } }),
        update: vi.fn(),
      },
    };
    const collabSource = liveCollaborativeDocument();
    const target = service(
      { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) },
      allowingPermissions(),
      undefined,
      undefined,
      collabSource,
    );

    await expect(
      target.update('editor-id', 'screenplay-id', { sourceText: 'é', version: 1 }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(collabSource.applySourceText).not.toHaveBeenCalled();
  });

  it('conflicts a collaborative sourceText write that lost the optimistic-concurrency race', async () => {
    const tx = {
      screenplay: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ sourceByteLength: 0, ownerUserId: 'owner-id', version: 4 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 0 } }),
        update: vi.fn(),
      },
    };
    const collabSource = liveCollaborativeDocument();
    const target = service(
      { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) },
      allowingPermissions(),
      undefined,
      undefined,
      collabSource,
    );

    await expect(
      target.update('editor-id', 'screenplay-id', { sourceText: 'FADE IN:\n', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(collabSource.applySourceText).not.toHaveBeenCalled();
  });

  it('reconciles a document bootstrapped while a plain sourceText write was in flight', async () => {
    const tx = {
      screenplay: {
        findFirst: vi.fn().mockResolvedValue({ sourceByteLength: 1, ownerUserId: 'owner-id' }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { sourceByteLength: 1 } }),
        update: vi.fn().mockResolvedValue(screenplay({ version: 2 })),
      },
    };
    const reconciled = screenplay({ version: 3, sourceText: 'é' });
    // A first join bootstrapped the document from the pre-write text between the two checks.
    const collabSource = {
      hasDocument: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      applySourceText: vi.fn().mockResolvedValue(3),
    };
    const target = service(
      {
        $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
        screenplay: { findFirst: vi.fn().mockResolvedValue(reconciled) },
      },
      allowingPermissions(),
      undefined,
      undefined,
      collabSource,
    );

    const result = await target.update('editor-id', 'screenplay-id', {
      sourceText: 'é',
      version: 1,
    });

    expect(collabSource.applySourceText).toHaveBeenCalledWith('screenplay-id', 'editor-id', 'é');
    expect(result).toEqual(reconciled);
  });
});
