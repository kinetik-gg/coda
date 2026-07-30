import { describe, expect, it } from 'vitest';
import type {
  ScreenplayRebaseClassification,
  ScreenplayRebaseExclusionReason,
  ScreenplayRebaseReason,
} from '@coda/contracts';
import {
  REBASE_ATTENTION,
  REBASE_CLASSIFICATION_LABEL,
  REBASE_EXCLUSION_EXPLANATION,
  REBASE_REASON_EXPLANATION,
  rebaseSummarySentence,
} from './screenplay-rebase-language';

const classifications: ScreenplayRebaseClassification[] = [
  'unchanged',
  'shifted-with-identical-text',
  'materially-changed',
  'deleted',
  'ambiguous',
];

const reasons: ScreenplayRebaseReason[] = [
  'identical-source-text',
  'inside-unchanged-prefix',
  'inside-unchanged-suffix',
  'unique-identical-match',
  'unique-identical-match-with-context',
  'replacement-region',
  'replacement-region-empty',
  'multiple-identical-matches',
  'recorded-hash-mismatch',
  'search-budget-exhausted',
];

const exclusions: ScreenplayRebaseExclusionReason[] = ['unpinned', 'pin-unavailable'];

describe('rebase vocabulary', () => {
  it('gives every classification and every stated ground its own words', () => {
    for (const classification of classifications) {
      expect(REBASE_CLASSIFICATION_LABEL[classification]).toBeTruthy();
    }
    for (const reason of reasons) expect(REBASE_REASON_EXPLANATION[reason]).toBeTruthy();
    for (const exclusion of exclusions)
      expect(REBASE_EXCLUSION_EXPLANATION[exclusion]).toBeTruthy();
    // Distinct wording throughout: two grounds that read the same could not explain a surprise.
    expect(new Set(Object.values(REBASE_REASON_EXPLANATION)).size).toBe(reasons.length);
    expect(new Set(Object.values(REBASE_CLASSIFICATION_LABEL)).size).toBe(classifications.length);
  });

  it('marks only the two auto-carry verdicts as needing no attention', () => {
    expect(REBASE_ATTENTION.unchanged).toBe('carry');
    expect(REBASE_ATTENTION['shifted-with-identical-text']).toBe('carry');
    // A deleted range has nothing to pick; an ambiguous one has too much. Different problems.
    expect(REBASE_ATTENTION.deleted).toBe('blocked');
    expect(REBASE_ATTENTION.ambiguous).toBe('choose');
    expect(REBASE_ATTENTION['materially-changed']).toBe('choose');
  });

  it('names the unpinned and unavailable states without calling either one stale', () => {
    for (const explanation of Object.values(REBASE_EXCLUSION_EXPLANATION)) {
      expect(explanation.toLowerCase()).not.toContain('stale');
    }
  });
});

describe('rebaseSummarySentence', () => {
  it('summarises the clean case in one line', () => {
    expect(
      rebaseSummarySentence({
        referenceCount: 4,
        autoCarryCount: 4,
        decisionCount: 0,
        excludedCount: 0,
      }),
    ).toBe('4 ranges carry over unchanged.');
  });

  it('names decisions and unrebasable references separately', () => {
    expect(
      rebaseSummarySentence({
        referenceCount: 3,
        autoCarryCount: 1,
        decisionCount: 2,
        excludedCount: 1,
      }),
    ).toBe(
      '1 range carries over unchanged · 2 ranges need a decision · 1 reference cannot be rebased.',
    );
  });

  it('says so plainly when there is nothing to review', () => {
    expect(
      rebaseSummarySentence({
        referenceCount: 0,
        autoCarryCount: 0,
        decisionCount: 0,
        excludedCount: 0,
      }),
    ).toBe('This breakdown has no source references.');
  });
});
