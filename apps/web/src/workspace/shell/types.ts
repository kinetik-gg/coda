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

/**
 * Context handed to a registry's declarative toolbar/controls contributions.
 * Extends the render context with the editor-supplied `controls` services bag,
 * the shared panel picker node, and the unified panel-action dispatcher bound
 * to this panel.
 */
export interface WorkspacePanelControlsContext<
  TPanel extends ShellPanel = WorkspacePanel,
  TControls = void,
> extends WorkspacePanelRenderContext<TPanel> {
  controls: TControls;
  panelPicker: ReactNode;
  dispatchAction: (action: string) => void;
}

export interface WorkspacePanelMenuItem {
  label: string;
  disabled?: boolean;
  action: () => void;
}

export interface WorkspacePanelDefinition<TPanel extends ShellPanel, TControls = void> {
  type: TPanel['type'];
  label: string;
  icon: ReactNode;
  createPanel: (panelId: string, current: TPanel) => TPanel;
  /** Declarative header toolbar composition for this panel type. */
  controls?: (context: WorkspacePanelControlsContext<TPanel, TControls>) => ReactNode;
  /** Declarative header commands rendered after the toolbar composition. */
  commands?: (context: WorkspacePanelControlsContext<TPanel, TControls>) => ReactNode;
  /** Extra items inserted at the top of the panel operations context menu. */
  menuItems?: (
    context: WorkspacePanelControlsContext<TPanel, TControls>,
  ) => WorkspacePanelMenuItem[];
}

export interface WorkspacePanelRegistry<TPanel extends ShellPanel, TControls = void> {
  definitions: readonly WorkspacePanelDefinition<TPanel, TControls>[];
  title: (panel: TPanel) => string;
  menuName?: (panel: TPanel) => string;
}

export interface PanelWorkspaceShellProps<
  TPanel extends ShellPanel,
  TLayout extends PanelLayout<TPanel>,
  TControls = void,
> {
  layout: TLayout;
  onLayoutChange: (layout: TLayout, change: WorkspaceShellChange<TPanel>) => void;
  reduceLayout: (layout: TLayout, action: PanelLayoutAction<TPanel>) => TLayout;
  panelRegistry: WorkspacePanelRegistry<TPanel, TControls>;
  maxPanels: number;
  maxDepth: number;
  renderPanel: (context: WorkspacePanelRenderContext<TPanel>) => ReactNode;
  /** Editor-supplied services threaded to the registry's declarative controls. */
  controlsContext?: TControls;
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

export type WorkspaceShellProps<TControls = void> = Omit<
  PanelWorkspaceShellProps<WorkspacePanel, WorkspaceLayout, TControls>,
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

export interface SplitTreeProps<
  TPanel extends ShellPanel,
  TLayout extends PanelLayout<TPanel>,
  TControls = void,
> {
  node: TLayout['root'];
  activeSlotId: string;
  fullscreenSlotId: string | null;
  panelRegistry: WorkspacePanelRegistry<TPanel, TControls>;
  renderPanel: PanelWorkspaceShellProps<TPanel, TLayout, TControls>['renderPanel'];
  controlsContext?: TControls;
  panelActions: (slot: PanelLayoutSlot<TPanel>) => PanelFrameActions<TPanel>;
  onActivate: (slotId: string) => void;
  onRatioCommit: (splitId: string, ratioBasisPoints: number) => void;
}
