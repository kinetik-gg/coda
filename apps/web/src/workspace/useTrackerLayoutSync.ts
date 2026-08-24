import { useWorkspaceLayoutSync, type LayoutResponse } from './use-layout-sync';

export type { StoredLayout, LayoutResponse } from './use-layout-sync';

/**
 * The tracker workspace's layout sync (#379): the same personal/default tiers, single-flight op
 * queue, silent 409 self-heal retry-once, and publish-conflict flow as the breakdown — one engine,
 * pointed at the tracker layout resource. Reset/publish arrive through the shared
 * `coda:reset-workspace` / `coda:publish-workspace` window events, exactly like the breakdown.
 */
export function useTrackerLayoutSync(trackerId: string, stored: LayoutResponse | undefined) {
  return useWorkspaceLayoutSync(`/api/v1/trackers/${trackerId}/workspace-layout`, stored);
}
