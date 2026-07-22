/**
 * Structural panel-layout types shared by product workspaces.
 *
 * Persisted schemas remain owned by each product surface. These types only
 * describe the tree shape used by the layout algorithms.
 */
export interface PanelLayoutPanel {
  id: string;
}

export interface PanelLayoutSlot<TPanel extends PanelLayoutPanel> {
  kind: 'panel';
  id: string;
  panel: TPanel;
}

export interface PanelLayoutSplitNode<TPanel extends PanelLayoutPanel> {
  kind: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratioBasisPoints: number;
  first: PanelLayoutNode<TPanel>;
  second: PanelLayoutNode<TPanel>;
}

export type PanelLayoutNode<TPanel extends PanelLayoutPanel> =
  PanelLayoutSlot<TPanel> | PanelLayoutSplitNode<TPanel>;

export interface PanelLayout<TPanel extends PanelLayoutPanel> {
  schemaVersion: number;
  root: PanelLayoutNode<TPanel>;
}
