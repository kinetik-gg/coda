import type { ReactNode } from 'react';
import type { WorkspaceLayout, WorkspacePanel } from '@coda/contracts';
import type {
  LayoutDirection,
  PanelLayout,
  PanelLayoutAction,
  PanelLayoutPanel,
  PanelLayoutSlot,
} from '../layout';

export interface ShellPanel extends PanelLayoutPanel {
  type: string;
}

export type WorkspaceShellChangeReason = 'split' | 'swap' | 'close' | 'join' | 'ratio' | 'replace';

export interface WorkspaceShellChange<TPanel extends ShellPanel = WorkspacePanel> {
  reason: WorkspaceShellChangeReason;
  action: PanelLayoutAction<TPanel>;
}

export interface WorkspacePanelRenderContext<TPanel extends ShellPanel = WorkspacePanel> {
  slot: PanelLayoutSlot<TPanel>;
  slotId: string;
  panel: TPanel;
  isActive: boolean;
  isFullscreen: boolean;
}

export interface WorkspacePanelToolbarContext<
  TPanel extends ShellPanel = WorkspacePanel,
> extends WorkspacePanelRenderContext<TPanel> {
  openPanelMenu: () => void;
  panelPicker?: ReactNode;
}

export interface WorkspacePanelMenuItem {
  label: string;
  disabled?: boolean;
  action: () => void;
}

export interface WorkspacePanelDefinition<TPanel extends ShellPanel> {
  type: TPanel['type'];
  label: string;
  icon: ReactNode;
  createPanel: (panelId: string, current: TPanel) => TPanel;
}

export interface WorkspacePanelRegistry<TPanel extends ShellPanel> {
  definitions: readonly WorkspacePanelDefinition<TPanel>[];
  title: (panel: TPanel) => string;
  menuName?: (panel: TPanel) => string;
}

export interface PanelWorkspaceShellProps<
  TPanel extends ShellPanel,
  TLayout extends PanelLayout<TPanel>,
> {
  layout: TLayout;
  onLayoutChange: (layout: TLayout, change: WorkspaceShellChange<TPanel>) => void;
  reduceLayout: (layout: TLayout, action: PanelLayoutAction<TPanel>) => TLayout;
  panelRegistry: WorkspacePanelRegistry<TPanel>;
  maxPanels: number;
  maxDepth: number;
  renderPanel: (context: WorkspacePanelRenderContext<TPanel>) => ReactNode;
  /** Optional panel-specific control rendered at the left edge of the compact area toolbar. */
  renderPanelToolbar?: (context: WorkspacePanelToolbarContext<TPanel>) => ReactNode;
  /** Optional commands rendered after the panel picker. */
  renderPanelCommands?: (context: WorkspacePanelRenderContext<TPanel>) => ReactNode;
  /** Optional commands inserted before the standard panel operations context menu. */
  renderPanelMenuItems?: (context: WorkspacePanelRenderContext<TPanel>) => WorkspacePanelMenuItem[];
  /** Shows the explicit layout-actions button. Context-menu access remains available when false. */
  showPanelMenuButton?: boolean;
  title?: ReactNode;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  canUndo?: boolean;
  onUndo?: () => void;
  activeSlotId?: string;
  onActiveSlotChange?: (slotId: string) => void;
  fullscreenSlotId?: string | null;
  onFullscreenSlotChange?: (slotId: string | null) => void;
  onOperationError?: (error: Error) => void;
  createId?: () => string;
  className?: string;
}

export type WorkspaceShellProps = Omit<
  PanelWorkspaceShellProps<WorkspacePanel, WorkspaceLayout>,
  'maxDepth' | 'maxPanels' | 'panelRegistry' | 'reduceLayout'
>;

export interface PanelFrameActions<TPanel extends ShellPanel = WorkspacePanel> {
  canSplit: boolean;
  canClose: boolean;
  canJoin: Readonly<Record<LayoutDirection, boolean>>;
  canSwap: Readonly<Record<LayoutDirection, boolean>>;
  onSplit: (axis: 'horizontal' | 'vertical') => void;
  onJoin: (direction: LayoutDirection) => void;
  onSwap: (direction: LayoutDirection) => void;
  onReplace: (panel: TPanel) => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
}

export interface SplitTreeProps<TPanel extends ShellPanel, TLayout extends PanelLayout<TPanel>> {
  node: TLayout['root'];
  activeSlotId: string;
  fullscreenSlotId: string | null;
  panelRegistry: WorkspacePanelRegistry<TPanel>;
  renderPanel: PanelWorkspaceShellProps<TPanel, TLayout>['renderPanel'];
  renderPanelToolbar?: PanelWorkspaceShellProps<TPanel, TLayout>['renderPanelToolbar'];
  renderPanelCommands?: PanelWorkspaceShellProps<TPanel, TLayout>['renderPanelCommands'];
  renderPanelMenuItems?: PanelWorkspaceShellProps<TPanel, TLayout>['renderPanelMenuItems'];
  showPanelMenuButton?: boolean;
  panelActions: (slot: PanelLayoutSlot<TPanel>) => PanelFrameActions<TPanel>;
  onActivate: (slotId: string) => void;
  onRatioCommit: (splitId: string, ratioBasisPoints: number) => void;
}
