import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
  type WorkspacePanelSlot,
  type WorkspaceSplitNode,
} from '@coda/contracts';
import { closePanelAutomatically } from './close';
import { joinPanelDirectionally } from './join';
import type { LayoutDirection } from './model';
import { findPanelSlot } from './validation';

export class LayoutOperationError extends Error {}

export type WorkspaceLayoutAction =
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
  | { type: 'set-ratio'; splitId: string; ratioBasisPoints: number };

function replaceNode(
  node: WorkspaceLayoutNode,
  nodeId: string,
  replace: (node: WorkspaceLayoutNode) => WorkspaceLayoutNode,
): WorkspaceLayoutNode {
  if (node.id === nodeId) return replace(node);
  if (node.kind === 'panel') return node;
  const first = replaceNode(node.first, nodeId, replace);
  const second = replaceNode(node.second, nodeId, replace);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function clonePanelSlot(
  source: WorkspacePanelSlot,
  newSlotId: string,
  newPanelId: string,
): WorkspacePanelSlot {
  const panel = structuredClone(source.panel);
  panel.id = newPanelId;
  return {
    kind: 'panel',
    id: newSlotId,
    panel,
  };
}

function swapPanelSlots(
  node: WorkspaceLayoutNode,
  first: WorkspacePanelSlot,
  second: WorkspacePanelSlot,
): WorkspaceLayoutNode {
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

function validated(layout: WorkspaceLayout): WorkspaceLayout {
  const result = workspaceLayoutSchema.safeParse(layout);
  if (!result.success)
    throw new LayoutOperationError(result.error.issues[0]?.message ?? 'Invalid layout');
  return result.data;
}

export function reduceWorkspaceLayout(
  layout: WorkspaceLayout,
  action: WorkspaceLayoutAction,
): WorkspaceLayout {
  if (action.type === 'split') {
    const source = findPanelSlot(layout.root, action.slotId);
    if (!source) throw new LayoutOperationError('Panel slot not found');
    const clone = clonePanelSlot(source, action.newSlotId, action.newPanelId);
    const split: WorkspaceSplitNode = {
      kind: 'split',
      id: action.splitId,
      axis: action.axis,
      ratioBasisPoints: action.ratioBasisPoints,
      first: action.placement === 'first' ? clone : source,
      second: action.placement === 'first' ? source : clone,
    };
    return validated({ ...layout, root: replaceNode(layout.root, source.id, () => split) });
  }

  if (action.type === 'swap') {
    if (action.firstSlotId === action.secondSlotId) return layout;
    const first = findPanelSlot(layout.root, action.firstSlotId);
    const second = findPanelSlot(layout.root, action.secondSlotId);
    if (!first || !second) throw new LayoutOperationError('Panel slot not found');
    const swapped = swapPanelSlots(layout.root, first, second);
    return validated({ ...layout, root: swapped });
  }

  if (action.type === 'close') {
    const result = closePanelAutomatically(layout, action.slotId);
    if (!result) throw new LayoutOperationError('Panel cannot be closed');
    return validated(result);
  }

  if (action.type === 'join') {
    const result = joinPanelDirectionally(layout, action.slotId, action.direction);
    if (!result) throw new LayoutOperationError('No adjacent branch in that direction');
    return validated(result);
  }

  let found = false;
  const root = replaceNode(layout.root, action.splitId, (node) => {
    if (node.kind !== 'split') throw new LayoutOperationError('Ratio target is not a split');
    found = true;
    return { ...node, ratioBasisPoints: action.ratioBasisPoints };
  });
  if (!found) throw new LayoutOperationError('Split not found');
  return validated({ ...layout, root });
}
