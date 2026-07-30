import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_REBASE_PLAN_VERSION,
  applyScreenplayRebaseSchema,
  type ApplyScreenplayRebaseInput,
  type ScreenplayRebaseDecisionInput,
  type ScreenplayRebasePlan,
} from '@coda/contracts';
import { resolveRebaseDecisions } from './screenplay-rebase-apply';
import { buildScreenplayRebasePlan } from './screenplay-rebase-plan';
import type { PinRow } from './source-revision-pin';

/**
 * The acceptance gate for issue #243's first criterion: **no materially changed, deleted, or
 * ambiguous reference can move to the target revision without a recorded explicit user decision.**
 *
 * Every plan here is built by the real assembler over the real compare engine rather than
 * hand-written, so the classifications the rules act on are the ones production would see. A
 * hand-made plan could accidentally assert `autoApplicable` on something the engine never would,
 * and the test would then be proving the rule against a fiction.
 */

const projectId = '00000000-0000-4000-8000-000000000001';
const screenplayId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const itemId = '00000000-0000-4000-8000-0000000000f1';
const referenceId = '00000000-0000-4000-8000-0000000000a1';
const otherReferenceId = '00000000-0000-4000-8000-0000000000a2';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const head = 'INT. OFFICE - DAY\n\nMAYA\nNot again.\n\n';
const tail = '\n\nINT. GARAGE - NIGHT\n\nA siren fades.';
const body = head + 'BODY LINE' + tail;

// The same line in two places in the target, both shifted: the engine will not choose between them.
const ambiguousSource = ['START', '', 'ECHO', '', 'MIDDLE', '', 'END'].join('\n');
const ambiguousTarget = ['BEGIN', '', 'ECHO', '', 'MIDDLE', '', 'ECHO', '', 'FINISH'].join('\n');

function pinFor(needle: string, source: string, id: string): PinRow {
  const start = source.indexOf(needle);
  return {
    itemSourceReferenceId: id,
    screenplayId,
    screenplayRevisionId: revisionId,
    screenplayVersion: 7,
    sourceStart: start,
    sourceEnd: start + needle.length,
    sourceTextHash: sha256(needle),
    createdById: 'user',
    updatedById: 'user',
    createdAt: new Date('2026-07-30T09:00:00.000Z'),
    updatedAt: new Date('2026-07-30T09:00:00.000Z'),
  };
}

/** One pinned reference quoting `needle` out of `source`, planned against `target`. */
function planFor(source: string, target: string, needle: string): ScreenplayRebasePlan {
  return buildScreenplayRebasePlan({
    projectId,
    screenplayId,
    linkUpdatedAt: new Date('2026-07-30T10:00:00.000Z'),
    target: { screenplayVersion: 9, screenplayRevisionId: null, sourceText: target },
    references: [{ id: referenceId, itemId }],
    pins: new Map([[referenceId, pinFor(needle, source, referenceId)]]),
    revisions: new Map([[revisionId, { screenplayVersion: 7, sourceText: source }]]),
    computedAt: new Date('2026-07-30T12:00:00.000Z'),
  });
}

function request(
  plan: ScreenplayRebasePlan,
  decisions: ScreenplayRebaseDecisionInput[] = [],
): ApplyScreenplayRebaseInput {
  return {
    planVersion: SCREENPLAY_REBASE_PLAN_VERSION,
    fingerprint: plan.fingerprint,
    decisions,
  };
}

/** Approves the plan's own proposal for the single entry, the way a reviewer clicking it would. */
function acceptProposal(plan: ScreenplayRebasePlan): ScreenplayRebaseDecisionInput {
  const entry = plan.entries[0]!;
  return {
    itemSourceReferenceId: entry.itemSourceReferenceId,
    action: 'retarget',
    source: entry.proposed!.range,
    sourceTextHash: entry.proposed!.textHash,
  };
}

describe('resolveRebaseDecisions carries only what the engine proved', () => {
  it('moves an unchanged range with no decision at all', () => {
    const plan = planFor(body, body, 'BODY LINE');
    const resolved = resolveRebaseDecisions(plan, request(plan));

    expect(plan.entries[0]!.classification).toBe('unchanged');
    expect(resolved.moves).toHaveLength(1);
    expect(resolved.applied[0]).toMatchObject({ outcome: 'carried', confirmed: false });
    expect(resolved.summary).toMatchObject({ carriedCount: 1, retargetedCount: 0, keptCount: 0 });
  });

  it('moves a uniquely shifted, byte-identical range with no decision at all', () => {
    const plan = planFor(body, `FADE IN:\n\n${body}`, 'BODY LINE');
    const resolved = resolveRebaseDecisions(plan, request(plan));

    expect(plan.entries[0]!.classification).toBe('shifted-with-identical-text');
    expect(resolved.moves[0]!.range).toEqual(plan.entries[0]!.proposed!.range);
    expect(resolved.moves[0]!.confirmed).toBe(false);
    expect(resolved.applied[0]!.outcome).toBe('carried');
  });

  it('refuses to move a materially changed range without a decision', () => {
    const plan = planFor(body, head + 'OTHER TEXT' + tail, 'BODY LINE');
    expect(plan.entries[0]!.classification).toBe('materially-changed');
    // It even carries a proposed anchor — and that proposal is still not permission to use it.
    expect(plan.entries[0]!.proposed).not.toBeNull();

    expect(() => resolveRebaseDecisions(plan, request(plan))).toThrow(BadRequestException);
    expect(() => resolveRebaseDecisions(plan, request(plan))).toThrow(
      /materially-changed and needs an explicit decision/,
    );
  });

  it('refuses to move a deleted range without a decision, and it has nothing to move to', () => {
    const plan = planFor(body, head + tail, 'BODY LINE');
    expect(plan.entries[0]!.classification).toBe('deleted');
    expect(plan.entries[0]!.proposed).toBeNull();
    expect(() => resolveRebaseDecisions(plan, request(plan))).toThrow(BadRequestException);
  });

  it('refuses to move an ambiguous range without a decision', () => {
    const plan = planFor(ambiguousSource, ambiguousTarget, 'ECHO');
    expect(plan.entries[0]!.classification).toBe('ambiguous');
    expect(plan.entries[0]!.proposed).toBeNull();
    expect(plan.entries[0]!.candidates.length).toBeGreaterThan(1);
    expect(() => resolveRebaseDecisions(plan, request(plan))).toThrow(BadRequestException);
  });

  it('refuses to move a pin that disagrees with its own revision', () => {
    const plan = buildScreenplayRebasePlan({
      projectId,
      screenplayId,
      linkUpdatedAt: new Date('2026-07-30T10:00:00.000Z'),
      target: { screenplayVersion: 9, screenplayRevisionId: null, sourceText: body },
      references: [{ id: referenceId, itemId }],
      pins: new Map([
        [
          referenceId,
          { ...pinFor('BODY LINE', body, referenceId), sourceTextHash: sha256('SOMETHING ELSE') },
        ],
      ]),
      revisions: new Map([[revisionId, { screenplayVersion: 7, sourceText: body }]]),
      computedAt: new Date('2026-07-30T12:00:00.000Z'),
    });
    expect(plan.entries[0]!.reason).toBe('recorded-hash-mismatch');
    expect(plan.entries[0]!.classification).toBe('ambiguous');
    expect(() => resolveRebaseDecisions(plan, request(plan))).toThrow(BadRequestException);
  });
});

describe('resolveRebaseDecisions honours a recorded decision', () => {
  it('moves a materially changed range once the reviewer approves the proposal', () => {
    const plan = planFor(body, head + 'OTHER TEXT' + tail, 'BODY LINE');
    const resolved = resolveRebaseDecisions(plan, request(plan, [acceptProposal(plan)]));

    expect(resolved.moves).toHaveLength(1);
    expect(resolved.moves[0]!.confirmed).toBe(true);
    // `retargeted`, never `carried`: the audit trail must never call a confirmed move an automatic
    // one, and it must never call an automatic move a confirmed one.
    expect(resolved.applied[0]).toMatchObject({
      outcome: 'retargeted',
      confirmed: true,
      classification: 'materially-changed',
    });
  });

  it('lets a reviewer pick any candidate on an ambiguous range, not just the first', () => {
    const plan = planFor(ambiguousSource, ambiguousTarget, 'ECHO');
    const chosen = plan.entries[0]!.candidates.at(-1)!;
    const resolved = resolveRebaseDecisions(
      plan,
      request(plan, [
        {
          itemSourceReferenceId: referenceId,
          action: 'retarget',
          source: chosen.range,
          sourceTextHash: chosen.textHash,
        },
      ]),
    );
    expect(resolved.moves[0]!.range).toEqual(chosen.range);
    expect(resolved.applied[0]!.confirmed).toBe(true);
  });

  it('writes nothing for a kept pin, whatever its classification', () => {
    const plan = planFor(body, head + tail, 'BODY LINE');
    const resolved = resolveRebaseDecisions(
      plan,
      request(plan, [{ itemSourceReferenceId: referenceId, action: 'keep' }]),
    );
    expect(resolved.moves).toEqual([]);
    expect(resolved.applied[0]).toMatchObject({
      outcome: 'kept',
      confirmed: true,
      source: null,
      sourceTextHash: null,
    });
    expect(resolved.summary).toMatchObject({ movedCount: 0, keptCount: 1 });
  });

  it('lets an explicit keep hold back a range the engine would have carried', () => {
    const plan = planFor(body, body, 'BODY LINE');
    const resolved = resolveRebaseDecisions(
      plan,
      request(plan, [{ itemSourceReferenceId: referenceId, action: 'keep' }]),
    );
    expect(resolved.moves).toEqual([]);
    expect(resolved.applied[0]!.outcome).toBe('kept');
  });
});

describe('resolveRebaseDecisions rejects an anchor nobody offered', () => {
  it('refuses a range that is not one of the entry candidates', () => {
    const plan = planFor(body, head + 'OTHER TEXT' + tail, 'BODY LINE');
    expect(() =>
      resolveRebaseDecisions(
        plan,
        request(plan, [
          {
            itemSourceReferenceId: referenceId,
            action: 'retarget',
            source: { start: 0, end: 5 },
            sourceTextHash: sha256('INT. '),
          },
        ]),
      ),
    ).toThrow(/offers no anchor at 0–5/);
  });

  it('refuses a candidate range whose text is not the text that was reviewed', () => {
    const plan = planFor(body, head + 'OTHER TEXT' + tail, 'BODY LINE');
    const proposal = acceptProposal(plan);
    expect(() =>
      resolveRebaseDecisions(
        plan,
        request(plan, [{ ...proposal, action: 'retarget', sourceTextHash: sha256('not this') }]),
      ),
    ).toThrow(ConflictException);
  });
});

describe('resolveRebaseDecisions rejects a stale plan rather than recomputing', () => {
  it('refuses when the fingerprint does not match the rebuilt plan', () => {
    const plan = planFor(body, body, 'BODY LINE');
    expect(() =>
      resolveRebaseDecisions(plan, { ...request(plan), fingerprint: sha256('some other plan') }),
    ).toThrow(ConflictException);
  });

  it('refuses when the screenplay text moved under a plan that still proposes the same anchor', () => {
    // Both plans classify the pin `unchanged` at the same offsets; only the text elsewhere differs.
    // The fingerprint covers the target's whole-text hash, so this is caught even though nothing
    // about the entry itself changed — which is the case a naive "did my anchor move?" check misses.
    const reviewed = planFor(body, body, 'BODY LINE');
    const rebuilt = planFor(body, body + '\n\nA new scene nobody reviewed.\n', 'BODY LINE');
    expect(rebuilt.entries[0]!.proposed!.range).toEqual(reviewed.entries[0]!.proposed!.range);
    expect(() => resolveRebaseDecisions(rebuilt, request(reviewed))).toThrow(ConflictException);
  });

  it('refuses a plan version it does not understand', () => {
    const plan = planFor(body, body, 'BODY LINE');
    expect(() => resolveRebaseDecisions(plan, { ...request(plan), planVersion: 99 })).toThrow(
      BadRequestException,
    );
  });
});

describe('resolveRebaseDecisions rejects an incoherent decision set', () => {
  it('refuses two decisions for the same reference', () => {
    const plan = planFor(body, body, 'BODY LINE');
    expect(() =>
      resolveRebaseDecisions(
        plan,
        request(plan, [
          { itemSourceReferenceId: referenceId, action: 'keep' },
          { itemSourceReferenceId: referenceId, action: 'keep' },
        ]),
      ),
    ).toThrow(/Two decisions were recorded/);
  });

  it('refuses a decision about a reference the plan does not carry', () => {
    const plan = planFor(body, body, 'BODY LINE');
    expect(() =>
      resolveRebaseDecisions(
        plan,
        request(plan, [{ itemSourceReferenceId: otherReferenceId, action: 'keep' }]),
      ),
    ).toThrow(/is not part of this rebase plan/);
  });

  it('refuses a decision about an excluded reference by name', () => {
    const plan = buildScreenplayRebasePlan({
      projectId,
      screenplayId,
      linkUpdatedAt: new Date('2026-07-30T10:00:00.000Z'),
      target: { screenplayVersion: 9, screenplayRevisionId: null, sourceText: body },
      references: [
        { id: referenceId, itemId },
        { id: otherReferenceId, itemId },
      ],
      pins: new Map([[referenceId, pinFor('BODY LINE', body, referenceId)]]),
      revisions: new Map([[revisionId, { screenplayVersion: 7, sourceText: body }]]),
      computedAt: new Date('2026-07-30T12:00:00.000Z'),
    });
    expect(plan.excluded[0]).toMatchObject({ itemSourceReferenceId: otherReferenceId });
    expect(() =>
      resolveRebaseDecisions(
        plan,
        request(plan, [{ itemSourceReferenceId: otherReferenceId, action: 'keep' }]),
      ),
    ).toThrow(/cannot be rebased/);
  });
});

describe('applyScreenplayRebaseSchema', () => {
  it('accepts a well-formed request', () => {
    expect(
      applyScreenplayRebaseSchema.parse({
        planVersion: 1,
        fingerprint: sha256('plan'),
        decisions: [{ itemSourceReferenceId: referenceId, action: 'keep' }],
      }).decisions,
    ).toHaveLength(1);
  });

  it('rejects a retarget with no anchor, which is the shape a silent carry would take', () => {
    expect(() =>
      applyScreenplayRebaseSchema.parse({
        planVersion: 1,
        fingerprint: sha256('plan'),
        decisions: [{ itemSourceReferenceId: referenceId, action: 'retarget' }],
      }),
    ).toThrow();
  });

  it('rejects an empty range, a bad hash, and an unknown action', () => {
    const base = { planVersion: 1, fingerprint: sha256('plan') };
    const cases = [
      [
        {
          itemSourceReferenceId: referenceId,
          action: 'retarget',
          source: { start: 5, end: 5 },
          sourceTextHash: sha256('x'),
        },
      ],
      [
        {
          itemSourceReferenceId: referenceId,
          action: 'retarget',
          source: { start: 0, end: 5 },
          sourceTextHash: 'NOT-A-HASH',
        },
      ],
      [{ itemSourceReferenceId: referenceId, action: 'carry' }],
    ];
    for (const decisions of cases) {
      expect(() => applyScreenplayRebaseSchema.parse({ ...base, decisions })).toThrow();
    }
  });
});
