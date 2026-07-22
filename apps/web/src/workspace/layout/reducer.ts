import { workspaceLayoutSchema, type WorkspaceLayout, type WorkspacePanel } from '@coda/contracts';
import {
  PanelLayoutOperationError,
  reducePanelLayout,
  type PanelLayoutAction,
} from './panel-layout-reducer';

export { PanelLayoutOperationError as LayoutOperationError };

export type WorkspaceLayoutAction = PanelLayoutAction<WorkspacePanel>;

export function reduceWorkspaceLayout(
  layout: WorkspaceLayout,
  action: WorkspaceLayoutAction,
): WorkspaceLayout {
  return reducePanelLayout(layout, action, {
    clonePanel: (source, newPanelId) => ({ ...structuredClone(source), id: newPanelId }),
    validateLayout: (candidate) => {
      const result = workspaceLayoutSchema.safeParse(candidate);
      if (!result.success) {
        throw new PanelLayoutOperationError(result.error.issues[0]?.message ?? 'Invalid layout');
      }
      return result.data;
    },
  });
}
