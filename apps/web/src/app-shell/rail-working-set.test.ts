import { describe, expect, it } from 'vitest';
import type { ScreenplaySummary } from '../screenplays/types';
import { buildWorkingSet } from './rail-working-set';

function screenplay(overrides: Partial<ScreenplaySummary> & { id: string }): ScreenplaySummary {
  return {
    ownerUserId: 'user',
    title: overrides.id,
    filename: `${overrides.id}.fountain`,
    paperSize: 'us-letter',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWorkingSet', () => {
  const nightfall = screenplay({
    id: 'a',
    title: 'Nightfall',
    filename: 'nightfall.fountain',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  const saltFlats = screenplay({
    id: 'b',
    title: 'Salt Flats',
    filename: 'salt-flats.fountain',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
  const oldDraft = screenplay({
    id: 'c',
    title: 'Old Draft',
    filename: 'old-draft.fountain',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('orders unpinned screenplays by recency, most recent first', () => {
    const entries = buildWorkingSet([nightfall, saltFlats, oldDraft], new Set(), '');
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    expect(entries.every((entry) => !entry.pinned)).toBe(true);
  });

  it('lists pinned screenplays ahead of unpinned ones, each still recency-ordered', () => {
    const entries = buildWorkingSet([nightfall, saltFlats, oldDraft], new Set(['c']), '');
    expect(entries.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
    expect(entries.find((entry) => entry.id === 'c')?.pinned).toBe(true);
    expect(entries.find((entry) => entry.id === 'a')?.pinned).toBe(false);
  });

  it('caps the unfiltered recent list without dropping pinned entries', () => {
    const recents = Array.from({ length: 12 }, (_, index) =>
      screenplay({
        id: `recent-${index}`,
        updatedAt: new Date(2026, 0, index + 1).toISOString(),
      }),
    );
    const entries = buildWorkingSet(recents, new Set(['recent-0']), '');
    // One pinned entry (kept regardless of recency) plus the 8-item recency cap.
    expect(entries).toHaveLength(9);
    expect(entries[0]?.id).toBe('recent-0');
  });

  it('searches the full library by title or filename once a filter is entered, ignoring the cap', () => {
    const recents = Array.from({ length: 12 }, (_, index) =>
      screenplay({ id: `recent-${index}`, updatedAt: new Date(2026, 0, index + 1).toISOString() }),
    );
    const entries = buildWorkingSet([...recents, nightfall, saltFlats], new Set(), 'night');
    expect(entries.map((entry) => entry.id)).toEqual(['a']);
  });

  it('matches the filename as well as the title, case-insensitively', () => {
    const entries = buildWorkingSet([nightfall, saltFlats], new Set(), 'SALT-FLATS');
    expect(entries.map((entry) => entry.id)).toEqual(['b']);
  });

  it('returns an empty list for a filter with no matches', () => {
    expect(buildWorkingSet([nightfall, saltFlats], new Set(), 'zzz')).toEqual([]);
  });

  it('returns an empty list for an empty library', () => {
    expect(buildWorkingSet([], new Set(), '')).toEqual([]);
  });
});
