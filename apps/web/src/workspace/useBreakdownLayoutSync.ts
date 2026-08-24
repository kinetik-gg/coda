import { useWorkspaceLayoutSync, type LayoutResponse } from './use-layout-sync';

export type { StoredLayout, LayoutResponse } from './use-layout-sync';

/**
 * The breakdown workspace's layout sync: the shared self-healing engine pointed at the project
 * layout resource. Behavior lives in `use-layout-sync` so the breakdown and tracker workspaces
 * cannot drift.
 */
export function useBreakdownLayoutSync(projectId: string, stored: LayoutResponse | undefined) {
  return useWorkspaceLayoutSync(`/api/v1/projects/${projectId}/workspace-layout`, stored);
}
