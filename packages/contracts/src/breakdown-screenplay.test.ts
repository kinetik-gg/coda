import { describe, expect, it } from 'vitest';
import { FOUNTAIN_SOURCE_MAX_CHARACTERS } from './index';
import {
  SCREENPLAY_REBASE_AUTO_CARRY_CLASSIFICATIONS,
  SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH,
  SCREENPLAY_REBASE_PLAN_VERSION,
  SCREENPLAY_SOURCE_MAX_OFFSET,
  SCREENPLAY_SOURCE_OFFSET_UNIT,
  pinSourceReferenceRevisionSchema,
  pinStaleness,
  screenplayRebasePlanIdentity,
  screenplaySourceRangeSchema,
  screenplaySourceTextHashSchema,
  type ScreenplayRebaseFingerprintInput,
} from './breakdown-screenplay';

describe('screenplay source range', () => {
  it('names UTF-16 code units and stops at the Fountain source ceiling', () => {
    expect(SCREENPLAY_SOURCE_OFFSET_UNIT).toBe('utf16-code-unit');
    // A range must never be able to point past the longest source the product accepts.
    expect(SCREENPLAY_SOURCE_MAX_OFFSET).toBe(FOUNTAIN_SOURCE_MAX_CHARACTERS);
  });

  it('accepts a half-open range and rejects an empty or inverted one', () => {
    expect(screenplaySourceRangeSchema.parse({ start: 0, end: 1 })).toEqual({ start: 0, end: 1 });
    expect(screenplaySourceRangeSchema.safeParse({ start: 12, end: 12 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 9, end: 4 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: -1, end: 4 }).success).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 1.5, end: 4 }).success).toBe(false);
  });

  it('rejects an offset beyond the ceiling and any unknown key', () => {
    expect(
      screenplaySourceRangeSchema.safeParse({ start: 0, end: SCREENPLAY_SOURCE_MAX_OFFSET + 1 })
        .success,
    ).toBe(false);
    expect(screenplaySourceRangeSchema.safeParse({ start: 0, end: 4, unit: 'bytes' }).success).toBe(
      false,
    );
  });

  it('accepts only a lowercase hex sha256 digest', () => {
    expect(screenplaySourceTextHashSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(screenplaySourceTextHashSchema.safeParse('A'.repeat(64)).success).toBe(false);
    expect(screenplaySourceTextHashSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });
});

describe('pinSourceReferenceRevisionSchema', () => {
  it('requires the mutable screenplay version the range was read from', () => {
    expect(
      pinSourceReferenceRevisionSchema.parse({
        screenplayVersion: 7,
        source: { start: 40, end: 96 },
      }),
    ).toEqual({ screenplayVersion: 7, source: { start: 40, end: 96 } });
    expect(
      pinSourceReferenceRevisionSchema.safeParse({ source: { start: 40, end: 96 } }).success,
    ).toBe(false);
    expect(
      pinSourceReferenceRevisionSchema.safeParse({
        screenplayVersion: 0,
        source: { start: 40, end: 96 },
      }).success,
    ).toBe(false);
  });

  it('rejects a revision id in the body: the server chooses the revision', () => {
    expect(
      pinSourceReferenceRevisionSchema.safeParse({
        screenplayVersion: 7,
        source: { start: 40, end: 96 },
        screenplayRevisionId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});

describe('pinStaleness', () => {
  it('reports current when the live version has not moved past the pinned one', () => {
    expect(pinStaleness(7, 7)).toBe('current');
  });

  it('reports current for a live version that is somehow behind the pinned one', () => {
    // Should never happen — a revision is always cut from a version at least as new as any earlier
    // pin — but the comparison direction must not flip a lower live version into "stale".
    expect(pinStaleness(7, 5)).toBe('current');
  });

  it('reports stale the moment the live version advances past the pinned one', () => {
    expect(pinStaleness(7, 8)).toBe('stale');
    expect(pinStaleness(1, 2)).toBe('stale');
  });
});

const referenceA = '00000000-0000-4000-8000-0000000000a1';
const referenceB = '00000000-0000-4000-8000-0000000000b2';

function fingerprintInput(
  overrides: Partial<ScreenplayRebaseFingerprintInput> = {},
): ScreenplayRebaseFingerprintInput {
  return {
    planVersion: SCREENPLAY_REBASE_PLAN_VERSION,
    projectId: '00000000-0000-4000-8000-000000000001',
    screenplayId: '00000000-0000-4000-8000-000000000002',
    linkUpdatedAt: '2026-07-30T10:00:00.000Z',
    target: {
      screenplayVersion: 9,
      screenplayRevisionId: null,
      sourceTextHash: 'a'.repeat(64),
      sourceLength: 4_096,
    },
    entries: [
      {
        itemSourceReferenceId: referenceA,
        screenplayRevisionId: '00000000-0000-4000-8000-000000000003',
        screenplayVersion: 7,
        pinUpdatedAt: '2026-07-30T09:00:00.000Z',
        source: { start: 40, end: 96 },
        sourceTextHash: 'b'.repeat(64),
        recordedTextHash: 'b'.repeat(64),
        classification: 'shifted-with-identical-text',
        autoApplicable: true,
        proposed: { start: 52, end: 108 },
      },
    ],
    excluded: [],
    ...overrides,
  };
}

describe('screenplay rebase plan contract', () => {
  it('names the plan version, the excerpt ceiling, and the auto-carry classifications', () => {
    expect(SCREENPLAY_REBASE_PLAN_VERSION).toBe(1);
    expect(SCREENPLAY_REBASE_EXCERPT_MAX_LENGTH).toBe(2_000);
    // Exactly the two verdicts the engine is allowed to mark `autoApplicable`; nothing else may be
    // carried forward without a person saying so.
    expect(SCREENPLAY_REBASE_AUTO_CARRY_CLASSIFICATIONS).toEqual([
      'unchanged',
      'shifted-with-identical-text',
    ]);
  });
});

describe('screenplayRebasePlanIdentity', () => {
  it('is stable across the order entries and exclusions happen to be presented in', () => {
    const first = fingerprintInput({
      entries: [
        fingerprintInput().entries[0]!,
        { ...fingerprintInput().entries[0]!, itemSourceReferenceId: referenceB },
      ],
      excluded: [
        { itemSourceReferenceId: referenceB, itemId: 'i', reason: 'unpinned' },
        { itemSourceReferenceId: referenceA, itemId: 'i', reason: 'pin-unavailable' },
      ],
    });
    const reordered = fingerprintInput({
      entries: [...first.entries].reverse(),
      excluded: [...first.excluded].reverse(),
    });
    expect(screenplayRebasePlanIdentity(reordered)).toBe(screenplayRebasePlanIdentity(first));
  });

  it('states the offset unit it was built against', () => {
    expect(screenplayRebasePlanIdentity(fingerprintInput())).toContain(
      SCREENPLAY_SOURCE_OFFSET_UNIT,
    );
  });

  it.each([
    [
      'the screenplay advancing a version',
      { target: { ...fingerprintInput().target, screenplayVersion: 10 } },
    ],
    [
      'the same version holding different text',
      { target: { ...fingerprintInput().target, sourceTextHash: 'c'.repeat(64) } },
    ],
    [
      'a revision appearing for the target version',
      { target: { ...fingerprintInput().target, screenplayRevisionId: 'r' } },
    ],
    ['the breakdown being relinked', { linkUpdatedAt: '2026-07-30T11:00:00.000Z' }],
    ['the breakdown following another screenplay', { screenplayId: 'other' }],
  ] satisfies ReadonlyArray<[string, Partial<ScreenplayRebaseFingerprintInput>]>)(
    'changes on %s',
    (_label, overrides) => {
      expect(screenplayRebasePlanIdentity(fingerprintInput(overrides))).not.toBe(
        screenplayRebasePlanIdentity(fingerprintInput()),
      );
    },
  );

  it('changes when a pin is re-pinned underneath the plan', () => {
    const repinned = fingerprintInput({
      entries: [{ ...fingerprintInput().entries[0]!, pinUpdatedAt: '2026-07-30T09:30:00.000Z' }],
    });
    expect(screenplayRebasePlanIdentity(repinned)).not.toBe(
      screenplayRebasePlanIdentity(fingerprintInput()),
    );
  });

  it('changes when the same inputs would yield a different proposed anchor', () => {
    // The anchor is covered deliberately: #243 must never apply a target no reviewer ever saw, even
    // when every input the anchor was derived from still matches.
    const moved = fingerprintInput({
      entries: [{ ...fingerprintInput().entries[0]!, proposed: { start: 53, end: 109 } }],
    });
    expect(screenplayRebasePlanIdentity(moved)).not.toBe(
      screenplayRebasePlanIdentity(fingerprintInput()),
    );
  });

  it('distinguishes an unresolved anchor from any real one', () => {
    const unresolved = fingerprintInput({
      entries: [
        {
          ...fingerprintInput().entries[0]!,
          classification: 'deleted',
          autoApplicable: false,
          proposed: null,
        },
      ],
    });
    expect(screenplayRebasePlanIdentity(unresolved)).not.toBe(
      screenplayRebasePlanIdentity(fingerprintInput()),
    );
  });

  it('changes when a reference stops being excluded', () => {
    const withExclusion = fingerprintInput({
      excluded: [{ itemSourceReferenceId: referenceB, itemId: 'i', reason: 'unpinned' }],
    });
    expect(screenplayRebasePlanIdentity(withExclusion)).not.toBe(
      screenplayRebasePlanIdentity(fingerprintInput()),
    );
  });
});
