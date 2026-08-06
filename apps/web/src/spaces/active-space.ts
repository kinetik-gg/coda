import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSpaces, type SpaceSummary } from '../api';

export const ACTIVE_SPACE_STORAGE_KEY = 'coda:active-space-id';

export function resolveActiveSpaceId(
  spaces: readonly SpaceSummary[],
  persistedSpaceId: string | null | undefined,
): string | undefined {
  if (persistedSpaceId && spaces.some((space) => space.id === persistedSpaceId)) {
    return persistedSpaceId;
  }
  return spaces[0]?.id;
}

function storedActiveSpaceId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_SPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistActiveSpaceId(spaceId: string | undefined): void {
  try {
    if (spaceId) window.localStorage.setItem(ACTIVE_SPACE_STORAGE_KEY, spaceId);
    else window.localStorage.removeItem(ACTIVE_SPACE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a private or embedded browser context; the in-memory choice
    // remains usable for this session.
  }
}

/** Fetches visible Spaces and keeps the client-only active preference valid as access changes. */
export function useActiveSpace() {
  const spaces = useQuery({
    queryKey: ['spaces'],
    queryFn: listSpaces,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [activeSpaceId, setActiveSpaceId] = useState<string | undefined>(
    () => storedActiveSpaceId() ?? undefined,
  );

  useEffect(() => {
    if (!spaces.data) return;
    const nextSpaceId = resolveActiveSpaceId(spaces.data, activeSpaceId);
    if (nextSpaceId === activeSpaceId) return;
    setActiveSpaceId(nextSpaceId);
    persistActiveSpaceId(nextSpaceId);
  }, [activeSpaceId, spaces.data]);

  const selectSpace = useCallback((spaceId: string) => {
    setActiveSpaceId(spaceId);
    persistActiveSpaceId(spaceId);
  }, []);
  const activeSpace = spaces.data?.find((space) => space.id === activeSpaceId);

  return { activeSpace, spaces: spaces.data ?? [], selectSpace };
}
