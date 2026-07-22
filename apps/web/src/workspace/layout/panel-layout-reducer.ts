import { closePanelAutomatically } from './close';
import { joinPanelDirectionally } from './join';
import type { LayoutDirection } from './model';
import type {
  PanelLayout,
  PanelLayoutNode,
  PanelLayoutPanel,
  PanelLayoutSlot,
  PanelLayoutSplitNode,
} from './primitives';
import { findPanelSlot } from './validation';

export class PanelLayoutOperationError extends Error {}

export type PanelLayoutAction<TPanel extends PanelLayoutPanel> =
  | {
      type: 'split';
      slotId: string;
      axis: 'horizontal' | 'vertical';
      ratioBasisPoints: number;
      splitId: string;
      newSlotId: string;
      newPanelId: string;
      placement?: 'first' | 'second';
    }
  | { type: 'swap'; firstSlotId: string; secondSlotId: string }
  | { type: 'close'; slotId: string }
  | { type: 'join'; slotId: string; direction: LayoutDirection }
  | { type: 'set-ratio'; splitId: string; ratioBasisPoints: number }
  | { type: 'replace'; slotId: string; panel: TPanel };

export interface PanelLayoutOperations<
  TPanel extends PanelLayoutPanel,
  TLayout extends PanelLayout<TPanel>,
> {
  clonePanel: (source: TPanel, newPanelId: string) => TPanel;
  validateLayout: (layout: TLayout) => TLayout;
}

function replaceNode<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
  nodeId: string,
  replace: (node: PanelLayoutNode<TPanel>) => PanelLayoutNode<TPanel>,
): PanelLayoutNode<TPanel> {
  if (node.id === nodeId) return replace(node);
  if (node.kind === 'panel') return node;
  const first = replaceNode(node.first, nodeId, replace);
  const second = replaceNode(node.second, nodeId, replace);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function swapPanelSlots<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
  first: PanelLayoutSlot<TPanel>,
  second: PanelLayoutSlot<TPanel>,
): PanelLayoutNode<TPanel> {
  if (node.kind === 'panel') {
    if (node.id === first.id) return second;
    if (node.id === second.id) return first;
    return node;
  }
  const nextFirst = swapPanelSlots(node.first, first, second);
  const nextSecond = swapPanelSlots(node.second, first, second);
  return nextFirst === node.first && nextSecond === node.second
    ? node
    : { ...node, first: nextFirst, second: nextSecond };
}

function splitPanel<TPanel extends PanelLayoutPanel, TLayout extends PanelLayout<TPanel>>(
  layout: TLayout,
  action: Extract<PanelLayoutAction<TPanel>, { type: 'split' }>,
  operations: PanelLayoutOperations<TPanel, TLayout>,
): PanelLayoutNode<TPanel> {
  const source = findPanelSlot(layout.root, action.slotId);
  if (!source) throw new PanelLayoutOperationError('Panel slot not found');
  const clone: PanelLayoutSlot<TPanel> = {
    kind: 'panel',
    id: action.newSlotId,
    panel: operations.clonePanel(source.panel, action.newPanelId),
  };
  const split: PanelLayoutSplitNode<TPanel> = {
    kind: 'split',
    id: action.splitId,
    axis: action.axis,
    ratioBasisPoints: action.ratioBasisPoints,
    first: action.placement === 'first' ? clone : source,
    second: action.placement === 'first' ? source : clone,
  };
  return replaceNode(layout.root, source.id, () => split);
}

function replacePanel<TPanel extends PanelLayoutPanel>(
  root: PanelLayoutNode<TPanel>,
  action: Extract<PanelLayoutAction<TPanel>, { type: 'replace' }>,
): PanelLayoutNode<TPanel> {
  const source = findPanelSlot(root, action.slotId);
  if (!source) throw new PanelLayoutOperationError('Panel slot not found');
  return replaceNode(root, source.id, () => ({ ...source, panel: action.panel }));
}

function swapPanels<TPanel extends PanelLayoutPanel>(
  root: PanelLayoutNode<TPanel>,
  action: Extract<PanelLayoutAction<TPanel>, { type: 'swap' }>,
): PanelLayoutNode<TPanel> {
  const first = findPanelSlot(root, action.firstSlotId);
  const second = findPanelSlot(root, action.secondSlotId);
  if (!first || !second) throw new PanelLayoutOperationError('Panel slot not found');
  return swapPanelSlots(root, first, second);
}

function setSplitRatio<TPanel extends PanelLayoutPanel>(
  root: PanelLayoutNode<TPanel>,
  action: Extract<PanelLayoutAction<TPanel>, { type: 'set-ratio' }>,
): PanelLayoutNode<TPanel> {
  let found = false;
  const next = replaceNode(root, action.splitId, (node) => {
    if (node.kind !== 'split') throw new PanelLayoutOperationError('Ratio target is not a split');
    found = true;
    return { ...node, ratioBasisPoints: action.ratioBasisPoints };
  });
  if (!found) throw new PanelLayoutOperationError('Split not found');
  return next;
}

/**
 * Applies layout-only operations while leaving schema ownership to the caller.
 * Every mutation passes through the supplied validator before it is returned.
 */
export function reducePanelLayout<
  TPanel extends PanelLayoutPanel,
  TLayout extends PanelLayout<TPanel>,
>(
  layout: TLayout,
  action: PanelLayoutAction<TPanel>,
  operations: PanelLayoutOperations<TPanel, TLayout>,
): TLayout {
  const validateRoot = (root: PanelLayoutNode<TPanel>): TLayout =>
    operations.validateLayout({ ...layout, root });

  if (action.type === 'split') {
    return validateRoot(splitPanel(layout, action, operations));
  }

  if (action.type === 'replace') {
    return validateRoot(replacePanel(layout.root, action));
  }

  if (action.type === 'swap') {
    if (action.firstSlotId === action.secondSlotId) return layout;
    return validateRoot(swapPanels(layout.root, action));
  }

  if (action.type === 'close') {
    const result = closePanelAutomatically(layout, action.slotId);
    if (!result) throw new PanelLayoutOperationError('Panel cannot be closed');
    return operations.validateLayout(result);
  }

  if (action.type === 'join') {
    const result = joinPanelDirectionally(layout, action.slotId, action.direction);
    if (!result) throw new PanelLayoutOperationError('No adjacent branch in that direction');
    return operations.validateLayout(result);
  }

  return validateRoot(setSplitRatio(layout.root, action));
}
