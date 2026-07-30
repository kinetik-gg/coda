import { ConflictException, Injectable } from '@nestjs/common';
import type {
  ApplyScreenplayRebaseInput,
  ScreenplayRebaseApplyResult,
  ScreenplayRebasePlan,
} from '@coda/contracts';
import { Prisma } from '@prisma/client';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { ScreenplaysService } from '../screenplays/screenplays.service';
import { resolveRebaseDecisions, type RebasePinMove } from './screenplay-rebase-apply';
import { readLiveScreenplay, readRebaseLink, readRebasePlan } from './screenplay-rebase-read';
import { excerptOf, sourceTextHash } from './source-revision-pin';

/** Applying a rebase rewrites what items are built from, so it takes the permission pinning takes. */
const APPLY_PERMISSION = 'manage_items' as const;

/**
 * Serializes applies for one breakdown against each other.
 *
 * Two applies of the same plan would otherwise both pass their fingerprint check before either
 * wrote, and the second would then find the pins already moved. `Serializable` alone would catch
 * that — as an abort, at commit time, after both did all their work. Taking the lock first turns a
 * race into a queue: the loser re-reads the pins the winner moved, rebuilds a plan whose fingerprint
 * no longer matches, and gets a clear `409` instead of a serialization failure.
 *
 * Routed through {@link DatabaseCapabilities} because `pg_advisory_xact_lock` is Postgres-only and
 * `scripts/check-db-portability.ts` keeps dialect-specific SQL out of `apps/api/src`.
 */
const APPLY_LOCK_PREFIX = 'breakdown-screenplay-rebase:';

/**
 * How long the writing transaction may run.
 *
 * Generous because the plan is rebuilt *inside* it: that means running the compare engine over the
 * screenplay's whole text while the transaction is open, which is the price of checking the
 * fingerprint against rows that cannot change before the write. Prisma's 5s default would fail a
 * feature-length screenplay under load.
 */
const APPLY_TRANSACTION_TIMEOUT_MS = 30_000;
const APPLY_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * Applies a reviewed rebase (issue #243) — the one mutating step in the flow.
 *
 * ## Everything that makes this safe happens inside one transaction
 *
 * The plan is not taken from the client. The client sends a `fingerprint` and its decisions; this
 * service rebuilds the plan from live rows *inside* the transaction it is about to write in, using
 * the same reader the preview uses, and refuses if the rebuilt fingerprint differs. A check outside
 * the transaction would be advisory: the screenplay could move, the link could be repointed, or a
 * pin could be re-pinned in the window between validating and writing. Inside it, under
 * `Serializable`, the rows the check read are the rows the write updates.
 *
 * The fingerprint covers the four independent staleness facts #242 fixed — the target version and
 * text hash, the link's `updatedAt`, and each pin's revision id and `updatedAt` — *and* every
 * proposed anchor. The anchors are in there deliberately: if the same inputs somehow produced a
 * different proposal, this refuses rather than moving a pin to an anchor no reviewer saw.
 *
 * ## What a confirmation authorises
 *
 * A `retarget` decision authorises exactly one anchor for exactly one reference: a range that must
 * be one of that entry's candidates in the rebuilt plan, carrying that candidate's text hash. It
 * does not authorise "whatever the plan proposes now", and it cannot name an offset the engine never
 * offered. A `keep` decision authorises nothing to be written at all. Everything else — the
 * `unchanged` and uniquely `shifted-with-identical-text` ranges the engine marked `autoApplicable` —
 * moves with no decision, which is the only silent carry-forward this service performs.
 *
 * ## The revision this service cuts
 *
 * A pin may only ever name an immutable `ScreenplayRevision`, and the preview is forbidden from
 * creating one, so the target revision is cut here — after the fingerprint check, so the plan the
 * check rebuilt reports the same `screenplayRevisionId` the reviewed plan did, and inside the
 * transaction, so a rolled-back apply leaves no orphan checkpoint behind.
 */
@Injectable()
export class ScreenplayRebaseApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
    private readonly screenplays: ScreenplaysService,
    private readonly db: DatabaseCapabilities,
  ) {}

  async apply(
    userId: string,
    projectId: string,
    input: ApplyScreenplayRebaseInput,
  ): Promise<ScreenplayRebaseApplyResult> {
    await this.permissions.assert(userId, projectId, APPLY_PERMISSION);
    try {
      return await this.prisma.$transaction(
        (tx) => this.applyWithin(tx, userId, projectId, input),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: APPLY_TRANSACTION_TIMEOUT_MS,
          maxWait: APPLY_TRANSACTION_MAX_WAIT_MS,
        },
      );
    } catch (error) {
      // A serialization failure means something this apply read was written concurrently. It is
      // deliberately **not** retried: a retry would rebuild the plan against the new state, and the
      // reviewer would then be applying decisions they made about text that has since changed. The
      // honest answer is the same one a fingerprint mismatch gives — preview it again.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'The screenplay or its pins changed while this rebase was being applied. Preview it again.',
        );
      }
      throw error;
    }
  }

  /**
   * The whole apply, in order, inside the transaction.
   *
   * The order is the design. Lock, then read the link, then authorize the screenplay it names — a
   * link repointed since the caller was authorized must not let this read a screenplay they cannot
   * see. Then rebuild the plan, then check it, and only then write.
   */
  private async applyWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    input: ApplyScreenplayRebaseInput,
  ): Promise<ScreenplayRebaseApplyResult> {
    await this.db.acquireTransactionLock(tx, APPLY_LOCK_PREFIX + projectId);

    const link = await readRebaseLink(tx, projectId);
    await this.screenplayPermissions.assert(userId, link.screenplayId, 'read_screenplay');
    const screenplay = await readLiveScreenplay(tx, link.screenplayId, undefined);
    const plan = await readRebasePlan(tx, {
      projectId,
      link,
      screenplay,
      computedAt: new Date(),
    });

    const resolved = resolveRebaseDecisions(plan, input);

    // Only now, once the plan has been proved to be the reviewed one, is anything created.
    const revision = await this.screenplays.ensureCheckpointWithin(
      tx,
      link.screenplayId,
      plan.target.screenplayVersion,
    );
    for (const move of resolved.moves) {
      await this.movePin(tx, { userId, projectId, revision, move });
    }
    await this.record(tx, { userId, projectId, plan, revisionId: revision.id, resolved });

    return {
      planVersion: plan.planVersion,
      projectId,
      screenplayId: link.screenplayId,
      fingerprint: plan.fingerprint,
      target: {
        screenplayVersion: plan.target.screenplayVersion,
        screenplayRevisionId: revision.id,
        sourceTextHash: plan.target.sourceTextHash,
      },
      applied: resolved.applied,
      summary: resolved.summary,
      appliedAt: new Date().toISOString(),
    };
  }

  /**
   * Moves one pin onto the target revision.
   *
   * Two guards, both cheap and both about honesty rather than about races the transaction already
   * covers. The hash is recomputed from the revision's *stored* text, so the hash written onto the
   * pin is provably the text at that range in the revision the pin now names — never a hash copied
   * from a plan. And the update is conditioned on the revision the pin is moving off, so a pin that
   * somehow changed identity fails loudly instead of being overwritten.
   */
  private async movePin(
    tx: Prisma.TransactionClient,
    context: {
      userId: string;
      projectId: string;
      revision: { id: string; screenplayVersion: number; sourceText: string };
      move: RebasePinMove;
    },
  ): Promise<void> {
    const { move, revision } = context;
    const hash = sourceTextHash(excerptOf(revision.sourceText, move.range));
    if (hash !== move.sourceTextHash) {
      throw new ConflictException(
        `The screenplay text at the anchor for source reference ${move.itemSourceReferenceId} changed while the rebase was being applied`,
      );
    }
    const updated = await tx.itemSourceRevisionPin.updateMany({
      where: {
        itemSourceReferenceId: move.itemSourceReferenceId,
        projectId: context.projectId,
        screenplayRevisionId: move.fromScreenplayRevisionId,
      },
      data: {
        screenplayRevisionId: revision.id,
        screenplayVersion: revision.screenplayVersion,
        sourceStart: move.range.start,
        sourceEnd: move.range.end,
        sourceTextHash: hash,
        updatedById: context.userId,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        `The pin for source reference ${move.itemSourceReferenceId} changed while the rebase was being applied`,
      );
    }
  }

  /**
   * Records the apply as one activity event rather than one per pin.
   *
   * A rebase is a single reviewed decision about a breakdown, and a hundred rows in the feed would
   * bury that. The metadata carries the fingerprint of the plan that was applied and the counts,
   * which is what makes the event auditable; who moved which pin where is on the pins themselves,
   * with `updatedById` and `updatedAt` set by this same transaction.
   */
  private async record(
    tx: Prisma.TransactionClient,
    context: {
      userId: string;
      projectId: string;
      plan: ScreenplayRebasePlan;
      revisionId: string;
      resolved: ReturnType<typeof resolveRebaseDecisions>;
    },
  ): Promise<void> {
    await tx.activityEvent.create({
      data: {
        projectId: context.projectId,
        actorId: context.userId,
        action: 'UPDATED',
        resourceType: 'breakdown_screenplay_rebase',
        resourceId: context.plan.screenplayId,
        metadata: {
          fingerprint: context.plan.fingerprint,
          screenplayVersion: context.plan.target.screenplayVersion,
          screenplayRevisionId: context.revisionId,
          ...context.resolved.summary,
        },
      },
    });
  }
}
