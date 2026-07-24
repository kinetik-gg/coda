export { PanelFrame } from './PanelFrame';
export { Splitter } from './Splitter';
export { SplitTree } from './SplitTree';
export { PanelWorkspaceShell, WorkspaceShell } from './WorkspaceShell';
export { breakdownPanelRegistry, type BreakdownControlsContext } from './breakdown-panel-registry';
export {
  dispatchPanelAction,
  subscribePanelAction,
  useRegisterPanelActions,
  type PanelActionHandler,
} from './panel-actions';
export type {
  PanelFrameActions,
  PanelWorkspaceShellProps,
  ShellPanel,
  SplitTreeProps,
  WorkspacePanelControlsContext,
  WorkspacePanelDefinition,
  WorkspacePanelMenuItem,
  WorkspacePanelRegistry,
  WorkspacePanelRenderContext,
  WorkspaceShellChange,
  WorkspaceShellChangeReason,
  WorkspaceShellProps,
} from './types';
