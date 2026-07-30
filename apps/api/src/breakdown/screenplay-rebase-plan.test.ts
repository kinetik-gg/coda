import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH,
  SCREENPLAY_REBASE_PLAN_VERSION,
} from '@coda/contracts';
import {
  buildScreenplayRebasePlan,
  type RebaseSourceRevision,
  type ScreenplayRebasePlanInput,
} from './screenplay-rebase-plan';
import type { PinRow } from './source-revision-pin';

const projectId = '00000000-0000-4000-8000-000000000001';
const screenplayId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const referenceId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000f1';

const linkUpdatedAt = new Date('2026-07-30T10:00:00.000Z');
const pinUpdatedAt = new Date('2026-07-30T09:00:00.000Z');
const computedAt = new Date('2026-07-30T12:00:00.000Z');

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function rangeOf(text: string, needle: string): { start: number; end: number } {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`Fixture needle "${needle}" is not in the source`);
  return { start, end: start + needle.length };
}

function pinRow(overrides: Partial<PinRow> = {}): PinRow {
  return {
    itemSourceReferenceId: referenceId,
    screenplayId,
    screenplayRevisionId: revisionId,
    screenplayVersion: 7,
    sourceStart: 0,
    sourceEnd: 1,
    sourceTextHash: sha256(''),
    createdById: 'user',
    updatedById: 'user',
    createdAt: pinUpdatedAt,
    updatedAt: pinUpdatedAt,
    ...overrides,
  };
}

interface ScenarioOptions {
  /** Overrides the recorded hash so the pin can disagree with its own revision. */
  recordedTextHash?: string;
  targetVersion?: number;
  targetRevisionId?: string | null;
}

/** One pinned reference quoting `needle` out of `source`, previewed against `target`. */
function scenario(source: string, target: string, needle: string, options: ScenarioOptions = {}) {
  const range = rangeOf(source, needle);
  const pin = pinRow({
    sourceStart: range.start,
    sourceEnd: range.end,
    sourceTextHash: options.recordedTextHash ?? sha256(needle),
  });
  return buildScreenplayRebasePlan({
    projectId,
    screenplayId,
    linkUpdatedAt,
    target: {
      screenplayVersion: options.targetVersion ?? 9,
      screenplayRevisionId: options.targetRevisionId ?? null,
      sourceText: target,
    },
    references: [{ id: referenceId, itemId }],
    pins: new Map([[referenceId, pin]]),
    revisions: new Map([[revisionId, { screenplayVersion: 7, sourceText: source }]]),
    computedAt,
  });
}

const head = 'INT. OFFICE - DAY\n\nMAYA\nNot again.\n\n';
const tail = '\n\nINT. GARAGE - NIGHT\n\nA siren fades.';
const body = head + 'BODY LINE' + tail;

describe('buildScreenplayRebasePlan classifications', () => {
  it('carries an untouched range forward without asking', () => {
    const plan = scenario(body, body, 'BODY LINE');
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('unchanged');
    expect(entry.reason).toBe('identical-source-text');
    expect(entry.autoApplicable).toBe(true);
    expect(entry.decisionRequired).toBe(false);
    expect(entry.proposed?.identicalText).toBe(true);
  });

  it('carries a uniquely shifted, byte-identical range forward without asking', () => {
    const plan = scenario(body, `FADE IN:\n\n${body}`, 'BODY LINE');
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('shifted-with-identical-text');
    expect(entry.autoApplicable).toBe(true);
    expect(entry.decisionRequired).toBe(false);
    expect(entry.proposed?.shift).toBe(10);
    expect(entry.proposed?.identicalText).toBe(true);
  });

  it('proposes but never auto-applies a materially changed range', () => {
    const plan = scenario(body, head + 'OTHER TEXT' + tail, 'BODY LINE');
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('materially-changed');
    expect(entry.reason).toBe('replacement-region');
    // A region to review, not an answer: proposed and required to be decided at the same time.
    expect(entry.proposed).not.toBeNull();
    expect(entry.autoApplicable).toBe(false);
    expect(entry.decisionRequired).toBe(true);
    expect(entry.proposed?.identicalText).toBe(false);
  });

  it('proposes nothing at all for a deleted range', () => {
    const plan = scenario(body, head + tail, 'BODY LINE');
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('deleted');
    expect(entry.reason).toBe('replacement-region-empty');
    expect(entry.proposed).toBeNull();
    expect(entry.candidates).toEqual([]);
    expect(entry.decisionRequired).toBe(true);
  });

  it('offers every candidate and picks none when the text matches in several places', () => {
    const plan = scenario(
      'START\n\nECHO\n\nMIDDLE\n\nEND',
      'BEGIN\n\nECHO\n\nMIDDLE\n\nECHO\n\nFINISH',
      'ECHO',
    );
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('ambiguous');
    expect(entry.reason).toBe('multiple-identical-matches');
    // Showing one of two identical matches would be the silent guess the whole flow exists to avoid.
    expect(entry.proposed).toBeNull();
    expect(entry.candidates).toHaveLength(2);
    expect(entry.candidates.every((candidate) => candidate.identicalText)).toBe(true);
    expect(entry.candidatesTruncated).toBe(false);
    expect(entry.decisionRequired).toBe(true);
  });

  it('refuses to re-anchor a pin whose recorded hash disagrees with its own revision', () => {
    const plan = scenario(body, body, 'BODY LINE', { recordedTextHash: 'f'.repeat(64) });
    const entry = plan.entries[0]!;
    expect(entry.classification).toBe('ambiguous');
    expect(entry.reason).toBe('recorded-hash-mismatch');
    expect(entry.from.recordedTextHashMatches).toBe(false);
    expect(entry.from.recordedTextHash).toBe('f'.repeat(64));
    // The hash the revision actually yields is reported beside it, so the disagreement is visible.
    expect(entry.from.excerpt.textHash).toBe(sha256('BODY LINE'));
    expect(entry.proposed).toBeNull();
    expect(entry.decisionRequired).toBe(true);
  });

  it('reports the reason for every verdict, so a plan explains itself', () => {
    for (const plan of [
      scenario(body, body, 'BODY LINE'),
      scenario(body, head + 'OTHER TEXT' + tail, 'BODY LINE'),
      scenario(body, head + tail, 'BODY LINE'),
    ]) {
      expect(plan.entries[0]!.reason).toBeTruthy();
    }
  });
});

describe('buildScreenplayRebasePlan evidence', () => {
  it('quotes the old text and hashes it, alongside the version it came from', () => {
    const plan = scenario(body, body, 'BODY LINE');
    const from = plan.entries[0]!.from;
    expect(from.excerpt.text).toBe('BODY LINE');
    expect(from.excerpt.textHash).toBe(sha256('BODY LINE'));
    expect(from.excerpt.textTruncated).toBe(false);
    expect(from.screenplayVersion).toBe(7);
    expect(from.screenplayRevisionId).toBe(revisionId);
    expect(from.pinUpdatedAt).toBe(pinUpdatedAt.toISOString());
  });

  it('truncates a long excerpt for display but hashes the whole thing', () => {
    const long = 'X'.repeat(SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH + 500);
    const source = `${head}${long}${tail}`;
    const plan = scenario(source, source, long);
    const excerpt = plan.entries[0]!.from.excerpt;
    expect(excerpt.text).toHaveLength(SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH);
    expect(excerpt.textTruncated).toBe(true);
    // The hash is the evidence #243 verifies against; it must never cover only what was displayed.
    expect(excerpt.textHash).toBe(sha256(long));
    expect(excerpt.range.end - excerpt.range.start).toBe(long.length);
  });

  it('reports a stale pin as stale and a pin on the live version as current', () => {
    expect(scenario(body, body, 'BODY LINE', { targetVersion: 9 }).entries[0]!.staleness).toBe(
      'stale',
    );
    expect(scenario(body, body, 'BODY LINE', { targetVersion: 7 }).entries[0]!.staleness).toBe(
      'current',
    );
  });

  it('describes the target by version and full-text hash, cutting no revision of its own', () => {
    const plan = scenario(body, body, 'BODY LINE');
    expect(plan.target.screenplayVersion).toBe(9);
    // `null` is the normal answer: the preview looks for an existing revision, it never creates one.
    expect(plan.target.screenplayRevisionId).toBeNull();
    expect(plan.target.sourceTextHash).toBe(sha256(body));
    expect(plan.target.sourceLength).toBe(body.length);
  });

  it('reports an already-cut revision for the target version when one happens to exist', () => {
    const plan = scenario(body, body, 'BODY LINE', { targetRevisionId: 'existing-revision' });
    expect(plan.target.screenplayRevisionId).toBe('existing-revision');
  });

  it('names the offset unit and the plan version it was built against', () => {
    const plan = scenario(body, body, 'BODY LINE');
    expect(plan.offsetUnit).toBe('utf16-code-unit');
    expect(plan.planVersion).toBe(SCREENPLAY_REBASE_PLAN_VERSION);
    expect(plan.computedAt).toBe(computedAt.toISOString());
    expect(plan.linkUpdatedAt).toBe(linkUpdatedAt.toISOString());
  });
});

function multiEntryInput(overrides: Partial<ScreenplayRebasePlanInput> = {}) {
  const source = body;
  const secondRevisionId = '00000000-0000-4000-8000-000000000004';
  const secondSource = `PROLOGUE\n\n${body}`;
  const references = [
    { id: 'ref-unchanged', itemId },
    { id: 'ref-changed', itemId },
    { id: 'ref-other-revision', itemId },
    { id: 'ref-unpinned', itemId },
    { id: 'ref-orphan', itemId },
  ];
  const pins = new Map<string, PinRow>([
    [
      'ref-unchanged',
      pinRow({
        itemSourceReferenceId: 'ref-unchanged',
        ...rangeAsPin(source, 'BODY LINE'),
        sourceTextHash: sha256('BODY LINE'),
      }),
    ],
    [
      'ref-changed',
      pinRow({
        itemSourceReferenceId: 'ref-changed',
        ...rangeAsPin(source, 'A siren fades.'),
        sourceTextHash: sha256('A siren fades.'),
      }),
    ],
    [
      'ref-other-revision',
      pinRow({
        itemSourceReferenceId: 'ref-other-revision',
        screenplayRevisionId: secondRevisionId,
        screenplayVersion: 8,
        ...rangeAsPin(secondSource, 'MAYA'),
        sourceTextHash: sha256('MAYA'),
      }),
    ],
    [
      'ref-orphan',
      pinRow({
        itemSourceReferenceId: 'ref-orphan',
        screenplayRevisionId: 'purged-revision',
        ...rangeAsPin(source, 'MAYA'),
        sourceTextHash: sha256('MAYA'),
      }),
    ],
  ]);
  const revisions = new Map<string, RebaseSourceRevision>([
    [revisionId, { screenplayVersion: 7, sourceText: source }],
    [secondRevisionId, { screenplayVersion: 8, sourceText: secondSource }],
  ]);
  return {
    projectId,
    screenplayId,
    linkUpdatedAt,
    target: {
      screenplayVersion: 9,
      screenplayRevisionId: null,
      sourceText: head + 'BODY LINE\n\nINT. GARAGE - NIGHT\n\nA klaxon fades.',
    },
    references,
    pins,
    revisions,
    computedAt,
    ...overrides,
  } satisfies ScreenplayRebasePlanInput;
}

function rangeAsPin(text: string, needle: string): { sourceStart: number; sourceEnd: number } {
  const range = rangeOf(text, needle);
  return { sourceStart: range.start, sourceEnd: range.end };
}

describe('buildScreenplayRebasePlan across a whole breakdown', () => {
  it('separates rebasable pins from references that cannot be rebased at all', () => {
    const plan = buildScreenplayRebasePlan(multiEntryInput());
    expect(plan.entries.map((entry) => entry.itemSourceReferenceId)).toEqual([
      'ref-unchanged',
      'ref-changed',
      'ref-other-revision',
    ]);
    // Neither of these is "stale". Neither has a pinned revision to compare against at all.
    expect(plan.excluded).toEqual([
      { itemSourceReferenceId: 'ref-unpinned', itemId, reason: 'unpinned' },
      { itemSourceReferenceId: 'ref-orphan', itemId, reason: 'pin-unavailable' },
    ]);
    expect(plan.entries.every((entry) => entry.staleness !== undefined)).toBe(true);
  });

  it('splits the summary into what may be carried and what needs a person', () => {
    const plan = buildScreenplayRebasePlan(multiEntryInput());
    expect(plan.summary.referenceCount).toBe(3);
    expect(plan.summary.autoCarryCount + plan.summary.decisionCount).toBe(3);
    expect(plan.summary.decisionCount).toBe(
      plan.entries.filter((entry) => entry.decisionRequired).length,
    );
    expect(plan.summary.excludedCount).toBe(2);
    // Excluded references are counted apart: they are not rebase decisions.
    expect(plan.summary.referenceCount).not.toBe(plan.entries.length + plan.excluded.length);
    const counted = Object.values(plan.summary.byClassification).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(3);
  });

  it('reports each distinct source revision once, ascending by version', () => {
    const plan = buildScreenplayRebasePlan(multiEntryInput());
    expect(plan.sourceRevisions.map((revision) => revision.screenplayVersion)).toEqual([7, 8]);
    expect(plan.sourceRevisions[0]!.sourceTextHash).toBe(sha256(body));
    expect(plan.sourceRevisions[0]!.sourceLength).toBe(body.length);
  });

  it('spends bounded search work and reports what it spent', () => {
    const plan = buildScreenplayRebasePlan(multiEntryInput());
    expect(plan.budget.exhausted).toBe(false);
    expect(plan.budget.searchPassesUsed).toBeLessThanOrEqual(plan.budget.maxSearchPasses);
    // Two distinct revisions, one budget each.
    expect(plan.budget.maxSearchPasses).toBe(256);
  });

  it('produces a byte-identical plan for identical inputs', () => {
    expect(JSON.stringify(buildScreenplayRebasePlan(multiEntryInput()))).toBe(
      JSON.stringify(buildScreenplayRebasePlan(multiEntryInput())),
    );
  });

  it('reports an empty plan for a breakdown with no source references', () => {
    const plan = buildScreenplayRebasePlan(
      multiEntryInput({ references: [], pins: new Map(), revisions: new Map() }),
    );
    expect(plan.entries).toEqual([]);
    expect(plan.excluded).toEqual([]);
    expect(plan.summary.referenceCount).toBe(0);
    expect(plan.sourceRevisions).toEqual([]);
    expect(plan.fingerprint).toHaveLength(64);
  });
});

describe('plan fingerprint', () => {
  it('is a lowercase sha256 that changes with the screenplay text', () => {
    const plan = buildScreenplayRebasePlan(multiEntryInput());
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const moved = buildScreenplayRebasePlan(
      multiEntryInput({
        target: { screenplayVersion: 10, screenplayRevisionId: null, sourceText: `${body} edited` },
      }),
    );
    expect(moved.fingerprint).not.toBe(plan.fingerprint);
  });

  it('changes when a pin is re-pinned underneath an otherwise identical plan', () => {
    const base = multiEntryInput();
    const repinned = new Map(base.pins);
    repinned.set(
      'ref-unchanged',
      pinRow({
        ...base.pins.get('ref-unchanged')!,
        updatedAt: new Date('2026-07-30T09:30:00.000Z'),
      }),
    );
    expect(buildScreenplayRebasePlan(multiEntryInput({ pins: repinned })).fingerprint).not.toBe(
      buildScreenplayRebasePlan(base).fingerprint,
    );
  });

  it('changes when the breakdown is relinked', () => {
    expect(
      buildScreenplayRebasePlan(
        multiEntryInput({ linkUpdatedAt: new Date('2026-07-30T11:00:00.000Z') }),
      ).fingerprint,
    ).not.toBe(buildScreenplayRebasePlan(multiEntryInput()).fingerprint);
  });

  it('does not change with the wall clock alone', () => {
    // `computedAt` is display only. A plan that changed identity every second could never be applied.
    expect(
      buildScreenplayRebasePlan(
        multiEntryInput({ computedAt: new Date('2027-01-01T00:00:00.000Z') }),
      ).fingerprint,
    ).toBe(buildScreenplayRebasePlan(multiEntryInput()).fingerprint);
  });
});
