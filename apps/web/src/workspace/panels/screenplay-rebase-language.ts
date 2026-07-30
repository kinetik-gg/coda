import type {
  ScreenplayRebaseClassification,
  ScreenplayRebaseExclusionReason,
  ScreenplayRebaseReason,
} from '@coda/contracts';

/**
 * The words the rebase preview (#242) puts on the compare engine's verdicts.
 *
 * The engine already decided *what* happened and *why*; this module only names those decisions in
 * English. Nothing here inspects a range, re-derives a classification, or infers a reason from a
 * classification — the plan carries `reason` precisely so the interface can explain itself without
 * guessing, and a lookup table is the smallest thing that cannot accidentally start guessing.
 *
 * Exhaustive `Record`s rather than switch statements, so adding a verdict to the contract fails to
 * compile here until it has been given words.
 */

/** What the reviewer is being asked to do about an entry. Drives emphasis, never the decision. */
export type RebaseAttention = 'carry' | 'choose' | 'blocked';

export const REBASE_CLASSIFICATION_LABEL: Record<ScreenplayRebaseClassification, string> = {
  unchanged: 'Unchanged',
  'shifted-with-identical-text': 'Moved, same text',
  'materially-changed': 'Text changed',
  deleted: 'Deleted',
  ambiguous: 'Needs a choice',
};

/**
 * How much attention each verdict deserves.
 *
 * `blocked` is not "worse than `choose`" — it means the plan proposes no anchor at all, so the only
 * decisions available are keeping the current pin or leaving it alone. Distinguishing the two is
 * what lets a reviewer tell "pick one of these" from "there is nothing to pick" at a glance.
 */
export const REBASE_ATTENTION: Record<ScreenplayRebaseClassification, RebaseAttention> = {
  unchanged: 'carry',
  'shifted-with-identical-text': 'carry',
  'materially-changed': 'choose',
  deleted: 'blocked',
  ambiguous: 'choose',
};

/** One sentence per stated ground, in the engine's own vocabulary. */
export const REBASE_REASON_EXPLANATION: Record<ScreenplayRebaseReason, string> = {
  'identical-source-text': 'The screenplay text is identical, so nothing moved.',
  'inside-unchanged-prefix': 'This range sits before the first edit, so its offsets are unchanged.',
  'inside-unchanged-suffix': 'This range sits after the last edit, so it only shifted.',
  'unique-identical-match': 'The exact text was found in one place and one place only.',
  'unique-identical-match-with-context':
    'The text appears more than once, but only one match kept the same surrounding lines.',
  'replacement-region': 'The text is gone; different text now occupies the space it held.',
  'replacement-region-empty': 'The text is gone and nothing took its place.',
  'multiple-identical-matches':
    'The text now appears in more than one place and the surrounding lines did not settle it.',
  'recorded-hash-mismatch':
    'The pin records different text than its own revision holds, so no re-anchor can be trusted.',
  'search-budget-exhausted':
    'The comparison ran out of its search budget before this range resolved. Reported rather than guessed.',
};

/**
 * Why a reference is listed but not up for rebasing.
 *
 * Neither of these is staleness. An unpinned or unavailable reference has no pinned revision on one
 * side of the comparison, so presenting it as rebasable would invent a decision nobody can make.
 */
export const REBASE_EXCLUSION_EXPLANATION: Record<ScreenplayRebaseExclusionReason, string> = {
  unpinned: 'Not pinned to the screenplay. Pin it before it can be rebased.',
  'pin-unavailable': 'Its pinned revision is no longer available, so there is nothing to compare.',
};

/** The one-line headline above the decision list. */
export function rebaseSummarySentence(summary: {
  referenceCount: number;
  autoCarryCount: number;
  decisionCount: number;
  excludedCount: number;
}): string {
  if (!summary.referenceCount && !summary.excludedCount) {
    return 'This breakdown has no source references.';
  }
  const carries = summary.autoCarryCount === 1 ? 'carries' : 'carry';
  const parts = [`${plural(summary.autoCarryCount, 'range')} ${carries} over unchanged`];
  if (summary.decisionCount) {
    const needs = summary.decisionCount === 1 ? 'needs' : 'need';
    parts.push(`${plural(summary.decisionCount, 'range')} ${needs} a decision`);
  }
  if (summary.excludedCount) {
    parts.push(`${plural(summary.excludedCount, 'reference')} cannot be rebased`);
  }
  return `${parts.join(' · ')}.`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
