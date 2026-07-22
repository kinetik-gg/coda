import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';
import type { PanelLayoutNode, PanelLayoutPanel, PanelLayoutSlot } from './primitives';

export function validateWorkspaceLayout(input: unknown): WorkspaceLayout {
  return workspaceLayoutSchema.parse(input);
}

export function safeValidateWorkspaceLayout(input: unknown) {
  return workspaceLayoutSchema.safeParse(input);
}

export function isWorkspaceLayout(input: unknown): input is WorkspaceLayout {
  return workspaceLayoutSchema.safeParse(input).success;
}

export function collectPanelSlots<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
): PanelLayoutSlot<TPanel>[] {
  if (node.kind === 'panel') return [node];
  return [...collectPanelSlots(node.first), ...collectPanelSlots(node.second)];
}

export function collectSplitIds<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
): string[] {
  if (node.kind === 'panel') return [];
  return [node.id, ...collectSplitIds(node.first), ...collectSplitIds(node.second)];
}

export function findPanelSlot<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
  slotId: string,
): PanelLayoutSlot<TPanel> | undefined {
  if (node.kind === 'panel') return node.id === slotId ? node : undefined;
  return findPanelSlot(node.first, slotId) ?? findPanelSlot(node.second, slotId);
}

export function findNode<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
  nodeId: string,
): PanelLayoutNode<TPanel> | undefined {
  if (node.id === nodeId) return node;
  if (node.kind === 'panel') return undefined;
  return findNode(node.first, nodeId) ?? findNode(node.second, nodeId);
}
