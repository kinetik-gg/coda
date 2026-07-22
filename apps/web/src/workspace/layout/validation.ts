import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
  type WorkspacePanelSlot,
} from '@coda/contracts';

export function validateWorkspaceLayout(input: unknown): WorkspaceLayout {
  return workspaceLayoutSchema.parse(input);
}

export function safeValidateWorkspaceLayout(input: unknown) {
  return workspaceLayoutSchema.safeParse(input);
}

export function isWorkspaceLayout(input: unknown): input is WorkspaceLayout {
  return workspaceLayoutSchema.safeParse(input).success;
}

export function collectPanelSlots(node: WorkspaceLayoutNode): WorkspacePanelSlot[] {
  if (node.kind === 'panel') return [node];
  return [...collectPanelSlots(node.first), ...collectPanelSlots(node.second)];
}

export function collectSplitIds(node: WorkspaceLayoutNode): string[] {
  if (node.kind === 'panel') return [];
  return [node.id, ...collectSplitIds(node.first), ...collectSplitIds(node.second)];
}

export function findPanelSlot(
  node: WorkspaceLayoutNode,
  slotId: string,
): WorkspacePanelSlot | undefined {
  if (node.kind === 'panel') return node.id === slotId ? node : undefined;
  return findPanelSlot(node.first, slotId) ?? findPanelSlot(node.second, slotId);
}

export function findNode(
  node: WorkspaceLayoutNode,
  nodeId: string,
): WorkspaceLayoutNode | undefined {
  if (node.id === nodeId) return node;
  if (node.kind === 'panel') return undefined;
  return findNode(node.first, nodeId) ?? findNode(node.second, nodeId);
}
