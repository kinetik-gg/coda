import { describe, expect, it } from 'vitest';
import type { ScheduledBackupRetention } from '@coda/contracts';
import {
  selectScheduledBackupsToPrune,
  type RetentionCandidate,
} from './scheduled-backup-retention';

const NOW = new Date('2026-07-24T12:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

/** Builds one archive per day, `count` days back, key `d<n>` = n days ago. */
function dailyArchives(count: number): RetentionCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `d${index}`,
    timestamp: daysAgo(index),
  }));
}

const policy = (overrides: Partial<ScheduledBackupRetention>): ScheduledBackupRetention => ({
  keepLast: 7,
  dailyForDays: 0,
  weeklyForWeeks: 0,
  maxAgeDays: 0,
  ...overrides,
});

describe('selectScheduledBackupsToPrune', () => {
  it('keeps everything when fewer archives than keepLast exist', () => {
    const decision = selectScheduledBackupsToPrune(dailyArchives(3), policy({ keepLast: 7 }), NOW);
    expect(decision.prune).toEqual([]);
    expect(decision.keep).toHaveLength(3);
  });

  it('keeps exactly the newest N and prunes the rest', () => {
    const decision = selectScheduledBackupsToPrune(dailyArchives(10), policy({ keepLast: 3 }), NOW);
    expect(decision.keep).toEqual(['d0', 'd1', 'd2']);
    expect(decision.prune).toEqual(['d3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']);
  });

  it('never prunes the newest N regardless of age (maxAge cannot override keepLast)', () => {
    const old = [
      { key: 'recent', timestamp: daysAgo(0) },
      { key: 'ancient1', timestamp: daysAgo(400) },
      { key: 'ancient2', timestamp: daysAgo(500) },
    ];
    const decision = selectScheduledBackupsToPrune(
      old,
      policy({ keepLast: 3, maxAgeDays: 30 }),
      NOW,
    );
    expect(decision.prune).toEqual([]);
    expect(decision.keep).toEqual(['recent', 'ancient1', 'ancient2']);
  });

  it('keeps a daily tier beyond keepLast', () => {
    // 20 daily archives; keepLast 2 + daily 7 => newest 7 distinct days kept.
    const decision = selectScheduledBackupsToPrune(
      dailyArchives(20),
      policy({ keepLast: 2, dailyForDays: 7 }),
      NOW,
    );
    expect(decision.keep).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    expect(decision.prune).toHaveLength(13);
  });

  it('keeps the newest archive within each day when multiple exist per day', () => {
    const candidates: RetentionCandidate[] = [
      { key: 'today-late', timestamp: new Date('2026-07-24T10:00:00Z') },
      { key: 'today-early', timestamp: new Date('2026-07-24T01:00:00Z') },
      { key: 'yesterday-late', timestamp: new Date('2026-07-23T23:00:00Z') },
      { key: 'yesterday-early', timestamp: new Date('2026-07-23T02:00:00Z') },
    ];
    const decision = selectScheduledBackupsToPrune(
      candidates,
      policy({ keepLast: 1, dailyForDays: 2 }),
      NOW,
    );
    expect(decision.keep.sort()).toEqual(['today-late', 'yesterday-late']);
    expect(decision.prune.sort()).toEqual(['today-early', 'yesterday-early']);
  });

  it('keeps a weekly tier beyond the daily tier', () => {
    const decision = selectScheduledBackupsToPrune(
      dailyArchives(60),
      policy({ keepLast: 1, dailyForDays: 7, weeklyForWeeks: 4 }),
      NOW,
    );
    // 7 daily picks (days 0..6) plus the newest of each of 4 distinct 7-day
    // buckets. Days 0..6 span two epoch-week buckets, so weekly adds the newest
    // of two further buckets before exhausting its window.
    expect(decision.keep.length).toBeGreaterThan(7);
    expect(decision.keep).toContain('d0');
    // Nothing beyond ~5 weeks survives.
    expect(decision.prune).toContain('d59');
  });

  it('caps daily/weekly tiers by max age but keeps keepLast', () => {
    const decision = selectScheduledBackupsToPrune(
      dailyArchives(30),
      policy({ keepLast: 2, dailyForDays: 30, maxAgeDays: 10 }),
      NOW,
    );
    // keepLast=2 keeps d0,d1; daily tier would keep d0..d29 but max-age 10 caps it
    // to archives <= 10 days old (d0..d10).
    expect(decision.keep).toEqual([
      'd0',
      'd1',
      'd2',
      'd3',
      'd4',
      'd5',
      'd6',
      'd7',
      'd8',
      'd9',
      'd10',
    ]);
    expect(decision.prune[0]).toBe('d11');
  });

  it('prunes to just keepLast when every tier is disabled', () => {
    const decision = selectScheduledBackupsToPrune(dailyArchives(5), policy({ keepLast: 1 }), NOW);
    expect(decision.keep).toEqual(['d0']);
    expect(decision.prune).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  it('handles an empty candidate set', () => {
    const decision = selectScheduledBackupsToPrune([], policy({ keepLast: 7 }), NOW);
    expect(decision).toEqual({ keep: [], prune: [] });
  });

  it('sorts unordered input newest-first before deciding', () => {
    const shuffled = [
      { key: 'd3', timestamp: daysAgo(3) },
      { key: 'd0', timestamp: daysAgo(0) },
      { key: 'd2', timestamp: daysAgo(2) },
      { key: 'd1', timestamp: daysAgo(1) },
    ];
    const decision = selectScheduledBackupsToPrune(shuffled, policy({ keepLast: 2 }), NOW);
    expect(decision.keep).toEqual(['d0', 'd1']);
    expect(decision.prune).toEqual(['d2', 'd3']);
  });
});
