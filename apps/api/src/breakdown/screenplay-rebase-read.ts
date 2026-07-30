import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ScreenplayRebasePlan } from '@coda/contracts';
import type { Prisma } from '@prisma/client';
import {
  buildScreenplayRebasePlan,
  type RebaseReference,
  type RebaseSourceRevision,
} from './screenplay-rebase-plan';
import type { PinRow } from './source-revision-pin';

/**
 * Every read a rebase plan is built from, in one read-only place (issues #242, #243).
 *
 * The preview runs these against the Prisma client; the apply runs the *same* functions against its
 * own transaction client, moments before it writes. That is the point of the seam: if the two
 * derived their plans from differently-shaped reads, the fingerprint the apply compares would be
 * computed over slightly different facts and the staleness check would quietly stop meaning
 * anything. One reader, one plan, two callers.
 *
 * Nothing here mutates, and `screenplay-rebase-preview.service.test.ts` gates this file's source
 * against every Prisma writing verb alongside the preview service's own, so the seam cannot become
 * the place a write sneaks back into the read path.
 */

/**
 * The client these reads run against.
 *
 * `Prisma.TransactionClient` rather than `PrismaService` on purpose: it is the narrower of the two
 * (no `$transaction`, no raw execution), and `PrismaService` is assignable to it, so the preview can
 * pass its client and the apply can pass its open transaction to the very same functions.
 */
export type RebaseReadClient = Prisma.TransactionClient;

export interface RebaseLink {
  screenplayId: string;
  updatedAt: Date;
}

/**
 * The link row, which carries both the screenplay a plan may target and the `updatedAt` that
 * invalidates the plan if the breakdown is relinked underneath it.
 */
export async function readRebaseLink(
  client: RebaseReadClient,
  projectId: string,
): Promise<RebaseLink> {
  const link = await client.breakdownScreenplayLink.findUnique({
    where: { projectId },
    select: { screenplayId: true, updatedAt: true },
  });
  if (!link) {
    throw new NotFoundException('Link a screenplay to this breakdown before rebasing');
  }
  return link;
}

/**
 * The screenplay's live, mutable text — the one place in this flow that reads it rather than a
 * revision, because "rebase onto the current screenplay" is precisely a question about live text.
 *
 * `expectedVersion` is the caller's optimistic-concurrency claim. Rejecting a mismatch with `409`
 * rather than quietly using a newer version keeps a plan from describing text the user has not seen,
 * and mirrors how pinning treats a stale `screenplayVersion`.
 */
export async function readLiveScreenplay(
  client: RebaseReadClient,
  screenplayId: string,
  expectedVersion: number | undefined,
): Promise<{ version: number; sourceText: string }> {
  const screenplay = await client.screenplay.findFirst({
    where: { id: screenplayId, deletedAt: null },
    select: { version: true, sourceText: true },
  });
  if (!screenplay) throw new NotFoundException('Screenplay not found');
  if (expectedVersion !== undefined && expectedVersion !== screenplay.version) {
    throw new ConflictException('Screenplay was modified by another session');
  }
  return screenplay;
}

/** Every active source reference in the breakdown, in a stable review order. */
async function readReferences(
  client: RebaseReadClient,
  projectId: string,
): Promise<RebaseReference[]> {
  return client.itemSourceReference.findMany({
    where: { item: { projectId, deletedAt: null } },
    select: { id: true, itemId: true },
    orderBy: [{ itemId: 'asc' }, { position: 'asc' }],
  });
}

/**
 * The pins for those references that point at the linked screenplay.
 *
 * Filtering on `screenplayId` matters: a pin left behind by an earlier link to a different
 * screenplay must not be compared against this screenplay's text. It is reported as excluded
 * `pin-unavailable` instead, because its revision is not among the ones loaded below.
 */
async function readPins(
  client: RebaseReadClient,
  projectId: string,
  screenplayId: string,
): Promise<Map<string, PinRow>> {
  const rows = await client.itemSourceRevisionPin.findMany({
    where: { projectId, screenplayId },
  });
  return new Map(rows.map((row) => [row.itemSourceReferenceId, row]));
}

/**
 * The text of each distinct revision those pins name, in one query keyed by revision id.
 *
 * Distinct-keyed rather than per-row on purpose: several references routinely share a revision, and
 * #240 established that this flow never issues a query per reference.
 */
async function readRevisions(
  client: RebaseReadClient,
  screenplayId: string,
  pins: ReadonlyMap<string, PinRow>,
): Promise<Map<string, RebaseSourceRevision>> {
  const ids = [...new Set([...pins.values()].map((pin) => pin.screenplayRevisionId))];
  if (!ids.length) return new Map();
  const rows = await client.screenplayRevision.findMany({
    where: { id: { in: ids }, screenplayId, screenplay: { deletedAt: null } },
    select: { id: true, screenplayVersion: true, sourceText: true },
  });
  return new Map(
    rows.map((row) => [row.id, { screenplayVersion: row.screenplayVersion, sourceText: row.sourceText }]),
  );
}

/**
 * The revision already cut for a version, if any.
 *
 * A pure lookup in both callers. The preview never creates one, which is what keeps it free of side
 * effects; the apply calls this *before* it cuts the revision, so the plan it rebuilds reports the
 * same `null` the reviewed plan did and the fingerprint comparison stays meaningful.
 */
export async function readRevisionIdForVersion(
  client: RebaseReadClient,
  screenplayId: string,
  screenplayVersion: number,
): Promise<string | null> {
  const revision = await client.screenplayRevision.findUnique({
    where: { screenplayId_screenplayVersion: { screenplayId, screenplayVersion } },
    select: { id: true },
  });
  return revision?.id ?? null;
}

/**
 * Reads everything and assembles the plan.
 *
 * `link` and `screenplay` are passed in rather than re-read because both callers have already loaded
 * them to authorize the request, and re-reading them here would open a window between the version
 * they authorized against and the version the plan describes.
 */
export async function readRebasePlan(
  client: RebaseReadClient,
  input: {
    projectId: string;
    link: RebaseLink;
    screenplay: { version: number; sourceText: string };
    computedAt: Date;
  },
): Promise<ScreenplayRebasePlan> {
  const screenplayId = input.link.screenplayId;
  const [references, pins] = await Promise.all([
    readReferences(client, input.projectId),
    readPins(client, input.projectId, screenplayId),
  ]);
  const [revisions, targetRevisionId] = await Promise.all([
    readRevisions(client, screenplayId, pins),
    readRevisionIdForVersion(client, screenplayId, input.screenplay.version),
  ]);

  return buildScreenplayRebasePlan({
    projectId: input.projectId,
    screenplayId,
    linkUpdatedAt: input.link.updatedAt,
    target: {
      screenplayVersion: input.screenplay.version,
      screenplayRevisionId: targetRevisionId,
      sourceText: input.screenplay.sourceText,
    },
    references,
    pins,
    revisions,
    computedAt: input.computedAt,
  });
}
