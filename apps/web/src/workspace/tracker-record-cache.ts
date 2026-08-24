import type { InfiniteData } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { CursorPage } from '../api';
import type { TrackerRecord } from '../trackers/types';

/**
 * Every grid-page variant (`['tracker-records', trackerId, params]`) shares one record vocabulary,
 * so a single authoritative row replaces itself in all of them. Used after mutations return the
 * fresh row (and after conflict refetches) instead of nuking the whole list.
 */
export function replaceRecordEverywhere(
  queryClient: QueryClient,
  trackerId: string,
  next: TrackerRecord,
): void {
  const queries = queryClient.getQueryCache().findAll({ queryKey: ['tracker-records', trackerId] });
  for (const query of queries) {
    queryClient.setQueryData<InfiniteData<CursorPage<TrackerRecord>>>(query.queryKey, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => (item.id === next.id ? next : item)),
            })),
          }
        : data,
    );
  }
}

export function removeRecordsEverywhere(
  queryClient: QueryClient,
  trackerId: string,
  ids: readonly string[],
): void {
  const doomed = new Set(ids);
  const queries = queryClient.getQueryCache().findAll({ queryKey: ['tracker-records', trackerId] });
  for (const query of queries) {
    queryClient.setQueryData<InfiniteData<CursorPage<TrackerRecord>>>(query.queryKey, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => !doomed.has(item.id)),
            })),
          }
        : data,
    );
  }
}
