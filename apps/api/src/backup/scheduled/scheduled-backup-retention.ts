import type { ScheduledBackupRetention } from '@coda/contracts';

/** A stored scheduled archive considered for retention. */
export interface RetentionCandidate {
  key: string;
  timestamp: Date;
}

/** The archives to keep and the archives to prune, both by key. */
export interface RetentionDecision {
  keep: string[];
  prune: string[];
}

const DAY_MS = 86_400_000;

/**
 * Decides which scheduled archives to prune for a rolling retention policy.
 *
 * The rules, applied to the archives newest-first:
 *  - `keepLast` is absolute: the newest N archives are always kept, whatever
 *    their age. This is the invariant that guarantees a misbehaving backend can
 *    never cause the newest backups to be deleted.
 *  - The daily tier keeps the newest archive of each of the most recent
 *    `dailyForDays` distinct UTC days; the weekly tier does the same for the most
 *    recent `weeklyForWeeks` distinct 7-day buckets.
 *  - A non-zero `maxAgeDays` caps the daily and weekly tiers: a tier pick older
 *    than the cap is not kept. It never overrides `keepLast`.
 *
 * The result is the set difference: everything not kept by any rule is pruned.
 * Pure and side-effect free so the retention matrix is exhaustively testable.
 */
export function selectScheduledBackupsToPrune(
  candidates: readonly RetentionCandidate[],
  retention: ScheduledBackupRetention,
  now: Date = new Date(),
): RetentionDecision {
  const sorted = [...candidates].sort(
    (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
  );
  const keep = new Set<string>();

  // keepLast — absolute, never pruned regardless of age.
  for (const candidate of sorted.slice(0, retention.keepLast)) keep.add(candidate.key);

  const maxAgeMs =
    retention.maxAgeDays > 0 ? retention.maxAgeDays * DAY_MS : Number.POSITIVE_INFINITY;
  const withinMaxAge = (candidate: RetentionCandidate): boolean =>
    now.getTime() - candidate.timestamp.getTime() <= maxAgeMs;

  if (retention.dailyForDays > 0) {
    selectTier(
      sorted,
      retention.dailyForDays,
      (timestamp) => Math.floor(timestamp.getTime() / DAY_MS),
      withinMaxAge,
      keep,
    );
  }
  if (retention.weeklyForWeeks > 0) {
    selectTier(
      sorted,
      retention.weeklyForWeeks,
      (timestamp) => Math.floor(timestamp.getTime() / (DAY_MS * 7)),
      withinMaxAge,
      keep,
    );
  }

  return {
    keep: sorted.filter((candidate) => keep.has(candidate.key)).map((candidate) => candidate.key),
    prune: sorted.filter((candidate) => !keep.has(candidate.key)).map((candidate) => candidate.key),
  };
}

/**
 * Keeps the newest archive of each of the most recent `limit` distinct buckets,
 * subject to the max-age gate. Candidates arrive newest-first, so the first
 * archive seen in a bucket is that bucket's newest.
 */
function selectTier(
  sorted: readonly RetentionCandidate[],
  limit: number,
  bucketOf: (timestamp: Date) => number,
  withinMaxAge: (candidate: RetentionCandidate) => boolean,
  keep: Set<string>,
): void {
  const seen = new Set<number>();
  for (const candidate of sorted) {
    const bucket = bucketOf(candidate.timestamp);
    if (seen.has(bucket)) continue;
    if (seen.size >= limit) break;
    seen.add(bucket);
    if (withinMaxAge(candidate)) keep.add(candidate.key);
  }
}
