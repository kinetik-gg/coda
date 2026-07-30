import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BreakdownScreenplayLinkService } from './breakdown-screenplay-link.service';

const projectId = '20000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const screenplayId = '20000000-0000-4000-8000-000000000003';
const otherScreenplayId = '20000000-0000-4000-8000-000000000004';

const createdAt = new Date('2026-07-30T10:00:00.000Z');
const updatedAt = new Date('2026-07-30T11:00:00.000Z');

function linkRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectId,
    screenplayId,
    createdById: userId,
    updatedById: userId,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function screenplayRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: screenplayId,
    title: 'Nightfall',
    filename: 'nightfall.fountain',
    version: 7,
    ...overrides,
  };
}

interface Harness {
  link: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  activityEvent: { create: ReturnType<typeof vi.fn> };
  screenplayFindFirst: ReturnType<typeof vi.fn>;
  projectAssert: ReturnType<typeof vi.fn>;
  screenplayAssert: ReturnType<typeof vi.fn>;
  service: BreakdownScreenplayLinkService;
}

function harness(options: { screenplay?: unknown } = {}): Harness {
  const link = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(linkRow()),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const activityEvent = { create: vi.fn().mockResolvedValue({}) };
  const screenplayFindFirst = vi
    .fn()
    .mockResolvedValue('screenplay' in options ? options.screenplay : screenplayRow());
  const tx = { breakdownScreenplayLink: link, activityEvent };
  const prisma = {
    breakdownScreenplayLink: link,
    screenplay: { findFirst: screenplayFindFirst },
    $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const projectAssert = vi
    .fn()
    .mockResolvedValue({ role: { permissions: [{ permission: 'manage_source_documents' }] } });
  const screenplayAssert = vi.fn().mockResolvedValue({});
  return {
    link,
    activityEvent,
    screenplayFindFirst,
    projectAssert,
    screenplayAssert,
    service: new BreakdownScreenplayLinkService(
      prisma as never,
      { assert: projectAssert } as never,
      { assert: screenplayAssert } as never,
    ),
  };
}

describe('BreakdownScreenplayLinkService.get', () => {
  it('reports no link for a breakdown that follows no screenplay', async () => {
    const context = harness();

    await expect(context.service.get(userId, projectId)).resolves.toEqual({
      link: null,
      canLink: true,
    });
    expect(context.projectAssert).toHaveBeenCalledWith(userId, projectId, 'read_project');
  });

  it('tells a read-only breakdown member it cannot link, so no control is offered', async () => {
    const context = harness();
    context.projectAssert.mockResolvedValue({
      role: { permissions: [{ permission: 'read_project' }, { permission: 'comment' }] },
    });

    await expect(context.service.get(userId, projectId)).resolves.toEqual({
      link: null,
      canLink: false,
    });
  });

  it('resolves the linked screenplay for a reader of both sides', async () => {
    const context = harness();
    context.link.findUnique.mockResolvedValue(linkRow());

    await expect(context.service.get(userId, projectId)).resolves.toEqual({
      canLink: true,
      link: {
        projectId,
        screenplayId,
        createdById: userId,
        updatedById: userId,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        screenplay: screenplayRow(),
      },
    });
  });

  it.each([
    ['a non-member of the screenplay', new NotFoundException('Screenplay not found')],
    ['a member whose role cannot read it', new ForbiddenException('Missing permission')],
  ])('reports a dangling link to %s rather than hiding it', async (_label, error) => {
    const context = harness();
    context.link.findUnique.mockResolvedValue(linkRow());
    context.screenplayAssert.mockRejectedValue(error);

    const result = await context.service.get(userId, projectId);

    expect(result.link).toMatchObject({ screenplayId, screenplay: null });
    expect(context.screenplayFindFirst).not.toHaveBeenCalled();
  });

  it('propagates an unexpected failure instead of downgrading it to an unreadable link', async () => {
    const context = harness();
    context.link.findUnique.mockResolvedValue(linkRow());
    context.screenplayAssert.mockRejectedValue(new Error('connection reset'));

    await expect(context.service.get(userId, projectId)).rejects.toThrow('connection reset');
  });

  it('reports a trashed or purged screenplay as unavailable', async () => {
    const context = harness({ screenplay: null });
    context.link.findUnique.mockResolvedValue(linkRow());

    await expect(context.service.get(userId, projectId)).resolves.toMatchObject({
      link: { screenplayId, screenplay: null },
    });
  });
});

describe('BreakdownScreenplayLinkService.link', () => {
  it('requires breakdown source authority and screenplay read access', async () => {
    const context = harness();

    await context.service.link(userId, projectId, screenplayId);

    expect(context.projectAssert).toHaveBeenCalledWith(
      userId,
      projectId,
      'manage_source_documents',
    );
    expect(context.screenplayAssert).toHaveBeenCalledWith(userId, screenplayId, 'read_screenplay');
  });

  it('checks the breakdown before the screenplay so the screenplay stays unobservable', async () => {
    const context = harness();
    context.projectAssert.mockRejectedValue(new NotFoundException('Project not found'));

    await expect(context.service.link(userId, projectId, screenplayId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(context.screenplayAssert).not.toHaveBeenCalled();
  });

  it('refuses to link a trashed screenplay a direct member can still assert on', async () => {
    const context = harness({ screenplay: null });

    await expect(context.service.link(userId, projectId, screenplayId)).rejects.toThrow(
      'Screenplay not found',
    );
    expect(context.link.upsert).not.toHaveBeenCalled();
  });

  it('replaces a previous link in place, keeping one screenplay per breakdown', async () => {
    const context = harness({ screenplay: screenplayRow({ id: otherScreenplayId }) });
    context.link.upsert.mockResolvedValue(linkRow({ screenplayId: otherScreenplayId }));

    const result = await context.service.link(userId, projectId, otherScreenplayId);

    expect(context.link.upsert).toHaveBeenCalledWith({
      where: { projectId },
      create: {
        projectId,
        screenplayId: otherScreenplayId,
        createdById: userId,
        updatedById: userId,
      },
      update: { screenplayId: otherScreenplayId, updatedById: userId },
    });
    expect(result.link?.screenplayId).toBe(otherScreenplayId);
  });

  it('records the link as breakdown activity with the screenplay version it saw', async () => {
    const context = harness();

    await context.service.link(userId, projectId, screenplayId);

    expect(context.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId,
        actorId: userId,
        action: 'UPDATED',
        resourceType: 'breakdown_screenplay_link',
        resourceId: screenplayId,
        metadata: { screenplayId, screenplayVersion: 7 },
      },
    });
  });
});

describe('BreakdownScreenplayLinkService.unlink', () => {
  it('clears the link without requiring any screenplay access', async () => {
    const context = harness();

    await expect(context.service.unlink(userId, projectId)).resolves.toEqual({
      link: null,
      canLink: true,
    });
    expect(context.link.deleteMany).toHaveBeenCalledWith({ where: { projectId } });
    expect(context.screenplayAssert).not.toHaveBeenCalled();
    expect(context.activityEvent.create).toHaveBeenCalledWith({
      data: {
        projectId,
        actorId: userId,
        action: 'DELETED',
        resourceType: 'breakdown_screenplay_link',
        resourceId: projectId,
        metadata: {},
      },
    });
  });

  it('stays silent when there was nothing linked', async () => {
    const context = harness();
    context.link.deleteMany.mockResolvedValue({ count: 0 });

    await context.service.unlink(userId, projectId);

    expect(context.activityEvent.create).not.toHaveBeenCalled();
  });

  it('still requires breakdown source authority', async () => {
    const context = harness();
    context.projectAssert.mockRejectedValue(new ForbiddenException('Missing permission'));

    await expect(context.service.unlink(userId, projectId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(context.link.deleteMany).not.toHaveBeenCalled();
  });
});
