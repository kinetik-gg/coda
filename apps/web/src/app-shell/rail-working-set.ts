import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { ScreenplaySummary } from '../screenplays/types';

const PINNED_STORAGE_KEY = 'coda:rail:pinned-screenplays';

/** How many unpinned screenplays the rail shows by default — enough to feel alive, not a second
 * content list. A non-empty filter searches the full library instead of this capped recency view. */
const RECENT_LIMIT = 8;

function readPinnedIds(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function writePinnedIds(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage may be unavailable (private browsing, quota) — pinning degrades to session-only
    // state, since `ids` still lives in memory for the rest of this session.
  }
}

/**
 * Pin state for the rail's working set. Client-only: Coda has no server-side "pinned" field, so a
 * pin is a per-browser affordance rather than a synced document property.
 */
export function useScreenplayPins(): {
  pinnedIds: ReadonlySet<string>;
  togglePin: (id: string) => void;
} {
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => readPinnedIds());
  const togglePin = useCallback((id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writePinnedIds(next);
      return next;
    });
  }, []);
  return { pinnedIds, togglePin };
}

export interface WorkingSetEntry {
  id: string;
  title: string;
  filename: string;
  pinned: boolean;
}

/**
 * Builds the rail's working set: pinned screenplays first (most recently updated within that set),
 * then the most recently updated remainder, capped to {@link RECENT_LIMIT}. A non-empty filter
 * searches every screenplay by title or filename instead, uncapped, so search never hides a match
 * behind the recency window.
 */
export function buildWorkingSet(
  screenplays: readonly ScreenplaySummary[],
  pinnedIds: ReadonlySet<string>,
  filter: string,
): WorkingSetEntry[] {
  const decorate = (screenplay: ScreenplaySummary): WorkingSetEntry => ({
    id: screenplay.id,
    title: screenplay.title,
    filename: screenplay.filename,
    pinned: pinnedIds.has(screenplay.id),
  });
  const byRecency = [...screenplays].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const term = filter.trim().toLowerCase();
  if (term) {
    return byRecency
      .filter(
        (screenplay) =>
          screenplay.title.toLowerCase().includes(term) ||
          screenplay.filename.toLowerCase().includes(term),
      )
      .map(decorate);
  }

  const pinned = byRecency.filter((screenplay) => pinnedIds.has(screenplay.id)).map(decorate);
  const recent = byRecency
    .filter((screenplay) => !pinnedIds.has(screenplay.id))
    .slice(0, RECENT_LIMIT)
    .map(decorate);
  return [...pinned, ...recent];
}

/**
 * The rail's live screenplay feed. Shares the `['screenplays']` query cache with `ScreenplaysScreen`
 * — mounting both costs one request, not two.
 */
export function useRailScreenplays() {
  return useQuery({
    queryKey: ['screenplays'],
    queryFn: () => api<ScreenplaySummary[]>('/api/v1/screenplays'),
  });
}
