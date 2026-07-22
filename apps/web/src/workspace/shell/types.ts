import type { ReactNode } from 'react';
import type { WorkspaceLayout, WorkspacePanel, WorkspacePanelSlot } from '@coda/contracts';
import type { LayoutDirection, WorkspaceLayoutAction } from '../layout';

export type WorkspaceShellChangeReason = 'split' | 'swap' | 'close' | 'join' | 'ratio';

export interface WorkspaceShellChange {
  reason: WorkspaceShellChangeReason;
  action: WorkspaceLayoutAction;
}

export interface WorkspacePanelRenderContext {
  slot: WorkspacePanelSlot;
  slotId: string;
  panel: WorkspacePanel;
  isActive: boolean;
  isFullscreen: boolean;
}

export interface WorkspacePanelToolbarContext extends WorkspacePanelRenderContext {
  openPanelMenu: () => void;
}

export interface WorkspacePanelMenuItem {
  label: string;
  disabled?: boolean;
  action: () => void;
}

export interface WorkspaceShellProps {
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout, change: WorkspaceShellChange) => void;
  renderPanel: (context: WorkspacePanelRenderContext) => ReactNode;
  /** Optional panel-specific control rendered at the left edge of the compact area toolbar. */
  renderPanelToolbar?: (context: WorkspacePanelToolbarContext) => ReactNode;
  /** Optional commands rendered after the panel picker. Defaults to View, Select, Add. */
  renderPanelCommands?: (context: WorkspacePanelRenderContext) => ReactNode;
  /** Optional commands inserted before the standard panel operations context menu. */
  renderPanelMenuItems?: (context: WorkspacePanelRenderContext) => WorkspacePanelMenuItem[];
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

export interface PanelFrameActions {
  canSplit: boolean;
  canClose: boolean;
  canJoin: Readonly<Record<LayoutDirection, boolean>>;
  canSwap: Readonly<Record<LayoutDirection, boolean>>;
  onSplit: (axis: 'horizontal' | 'vertical') => void;
  onJoin: (direction: LayoutDirection) => void;
  onSwap: (direction: LayoutDirection) => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
}

export interface SplitTreeProps {
  node: WorkspaceLayout['root'];
  activeSlotId: string;
  fullscreenSlotId: string | null;
  renderPanel: WorkspaceShellProps['renderPanel'];
  renderPanelToolbar?: WorkspaceShellProps['renderPanelToolbar'];
  renderPanelCommands?: WorkspaceShellProps['renderPanelCommands'];
  renderPanelMenuItems?: WorkspaceShellProps['renderPanelMenuItems'];
  panelActions: (slot: WorkspacePanelSlot) => PanelFrameActions;
  onActivate: (slotId: string) => void;
  onRatioCommit: (splitId: string, ratioBasisPoints: number) => void;
}
