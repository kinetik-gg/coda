import type { WorkspaceLayout, WorkspacePanelType } from '@coda/contracts';
import type { PanelLayout, PanelLayoutPanel } from './primitives';

export {
  WORKSPACE_LAYOUT_MAX_DEPTH,
  WORKSPACE_LAYOUT_MAX_PANELS,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  workspaceLayoutNodeSchema,
  workspaceLayoutSchema,
  workspacePanelSlotSchema,
} from '@coda/contracts';

export type {
  WorkspaceLayout,
  WorkspaceLayoutNode,
  WorkspacePanel,
  WorkspacePanelSlot,
  WorkspacePanelType,
  WorkspaceSplitNode,
} from '@coda/contracts';

/**
 * Panel types the breakdown workspace offers. The contracts union also carries the tracker
 * grid/board/matrix arms (epic #386); those are tracker-workspace surfaces with their own configs
 * and never flow through the breakdown panel factories, which all key off entity types.
 */
export type BreakdownPanelType = Exclude<WorkspacePanelType, 'grid' | 'board' | 'matrix'>;

export type LayoutDirection = 'left' | 'right' | 'up' | 'down';

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutAdjacency {
  fromSlotId: string;
  toSlotId: string;
  direction: LayoutDirection;
  sharedEdge: number;
}

export interface LayoutGeometry {
  bounds: LayoutRect;
  nodeRects: ReadonlyMap<string, LayoutRect>;
  slotRects: ReadonlyMap<string, LayoutRect>;
}

export interface LayoutCloseScore {
  changedPanels: number;
  geometryMovement: number;
  aspectDistortion: number;
  sharedEdge: number;
  stableKey: string;
}

export interface LayoutCloseCandidate<
  TLayout extends PanelLayout<PanelLayoutPanel> = WorkspaceLayout,
> {
  kind: 'edge-expansion' | 'sibling-fallback';
  direction: LayoutDirection;
  layout: TLayout;
  changedSlotIds: readonly string[];
  score: LayoutCloseScore;
}
