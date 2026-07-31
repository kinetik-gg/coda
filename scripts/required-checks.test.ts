import { describe, expect, it } from 'vitest';

import { diffBranchProtection, formatDrift, type RequiredChecksManifest } from './required-checks';

/**
 * Pins the comparison behind the required-check drift gate (issue #273): it must stay SILENT when
 * the live branch protection matches the committed manifest exactly, and it must FLAG each field
 * that disagrees — a changed context set, a toggled strict flag, a relaxed review count, or a
 * disabled admin enforcement — by name, not just "something changed".
 */

const MANIFEST: RequiredChecksManifest = {
  branch: 'main',
  requiredStatusChecks: {
    strict: true,
    contexts: ['Verify workspace', 'Build container'],
  },
  requiredPullRequestReviews: {
    requiredApprovingReviewCount: 0,
  },
  enforceAdmins: true,
  allowForcePushes: false,
  allowDeletions: false,
};

const MATCHING_LIVE = {
  required_status_checks: {
    strict: true,
    contexts: ['Build container', 'Verify workspace'],
  },
  required_pull_request_reviews: {
    required_approving_review_count: 0,
  },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

describe('diffBranchProtection', () => {
  it('is silent when the live protection matches the manifest, regardless of context order', () => {
    expect(diffBranchProtection(MANIFEST, MATCHING_LIVE)).toEqual([]);
  });

  it('flags a required context the manifest no longer lists', () => {
    const live = {
      ...MATCHING_LIVE,
      required_status_checks: {
        strict: true,
        contexts: ['Build container', 'Verify workspace', 'A new required check'],
      },
    };
    const drift = diffBranchProtection(MANIFEST, live);
    expect(drift.map((entry) => entry.field)).toEqual(['requiredStatusChecks.contexts']);
  });

  it('flags a required context that disappeared (e.g. a workflow rename)', () => {
    const live = {
      ...MATCHING_LIVE,
      required_status_checks: { strict: true, contexts: ['Build container'] },
    };
    const drift = diffBranchProtection(MANIFEST, live);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.field).toBe('requiredStatusChecks.contexts');
  });

  it('flags a toggled strict flag', () => {
    const live = {
      ...MATCHING_LIVE,
      required_status_checks: { ...MATCHING_LIVE.required_status_checks, strict: false },
    };
    expect(diffBranchProtection(MANIFEST, live).map((entry) => entry.field)).toEqual([
      'requiredStatusChecks.strict',
    ]);
  });

  it('flags a relaxed required approving review count', () => {
    const live = {
      ...MATCHING_LIVE,
      required_pull_request_reviews: { required_approving_review_count: 1 },
    };
    expect(diffBranchProtection(MANIFEST, live).map((entry) => entry.field)).toEqual([
      'requiredPullRequestReviews.requiredApprovingReviewCount',
    ]);
  });

  it('flags disabled admin enforcement', () => {
    const live = { ...MATCHING_LIVE, enforce_admins: { enabled: false } };
    expect(diffBranchProtection(MANIFEST, live).map((entry) => entry.field)).toEqual([
      'enforceAdmins',
    ]);
  });

  it('flags force-pushes or deletions becoming allowed', () => {
    const live = {
      ...MATCHING_LIVE,
      allow_force_pushes: { enabled: true },
      allow_deletions: { enabled: true },
    };
    expect(
      diffBranchProtection(MANIFEST, live)
        .map((entry) => entry.field)
        .sort(),
    ).toEqual(['allowDeletions', 'allowForcePushes']);
  });

  it('formats drift as one readable line per field', () => {
    const drift = diffBranchProtection(MANIFEST, {
      ...MATCHING_LIVE,
      enforce_admins: { enabled: false },
    });
    expect(formatDrift(drift)).toBe('  enforceAdmins: recorded true, live false');
  });
});
