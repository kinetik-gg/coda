import {
  LAYOUT_GEOMETRY_EPSILON,
  approximatelyEqual,
  deriveLayoutGeometry,
  rectBottom,
  rectRight,
  rectsApproximatelyEqual,
  sharedEdgeInDirection,
  UNIT_LAYOUT_RECT,
} from './geometry';
import type { LayoutCloseCandidate, LayoutCloseScore, LayoutDirection, LayoutRect } from './model';
import { reconstructGuillotineTree, type RectangularPanel } from './reconstruct';
import { collectPanelSlots, collectSplitIds } from './validation';
import type { PanelLayout, PanelLayoutNode, PanelLayoutPanel } from './primitives';

const DIRECTIONS: readonly LayoutDirection[] = ['left', 'right', 'up', 'down'];

function quantize(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function compareCloseScores(first: LayoutCloseScore, second: LayoutCloseScore): number {
  return (
    first.changedPanels - second.changedPanels ||
    quantize(first.geometryMovement) - quantize(second.geometryMovement) ||
    quantize(first.aspectDistortion) - quantize(second.aspectDistortion) ||
    quantize(second.sharedEdge) - quantize(first.sharedEdge) ||
    first.stableKey.localeCompare(second.stableKey)
  );
}

function scoreCandidate<TPanel extends PanelLayoutPanel>(
  original: PanelLayout<TPanel>,
  candidate: PanelLayout<TPanel>,
  closedSlotId: string,
  stableKey: string,
): { score: LayoutCloseScore; changedSlotIds: string[] } {
  const before = deriveLayoutGeometry(original);
  const after = deriveLayoutGeometry(candidate);
  const closedRect = before.slotRects.get(closedSlotId)!;
  const changedSlotIds: string[] = [];
  let geometryMovement = 0;
  let aspectDistortion = 0;
  let sharedEdge = 0;
  for (const [slotId, nextRect] of after.slotRects) {
    const previousRect = before.slotRects.get(slotId);
    if (!previousRect || rectsApproximatelyEqual(previousRect, nextRect)) continue;
    changedSlotIds.push(slotId);
    const previousCenterX = previousRect.x + previousRect.width / 2;
    const previousCenterY = previousRect.y + previousRect.height / 2;
    const nextCenterX = nextRect.x + nextRect.width / 2;
    const nextCenterY = nextRect.y + nextRect.height / 2;
    geometryMovement += Math.hypot(nextCenterX - previousCenterX, nextCenterY - previousCenterY);
    const previousAspect = previousRect.width / previousRect.height;
    const nextAspect = nextRect.width / nextRect.height;
    aspectDistortion += Math.abs(Math.log(nextAspect / previousAspect));
    for (const direction of DIRECTIONS)
      sharedEdge += sharedEdgeInDirection(closedRect, previousRect, direction);
  }
  changedSlotIds.sort();
  return {
    changedSlotIds,
    score: {
      changedPanels: changedSlotIds.length,
      geometryMovement,
      aspectDistortion,
      sharedEdge,
      stableKey,
    },
  };
}

function tilesClosedEdge(
  rects: readonly LayoutRect[],
  closed: LayoutRect,
  direction: LayoutDirection,
): boolean {
  if (!rects.length) return false;
  const vertical = direction === 'left' || direction === 'right';
  const sorted = [...rects].sort((first, second) =>
    vertical ? first.y - second.y : first.x - second.x,
  );
  let cursor = vertical ? closed.y : closed.x;
  const end = vertical ? rectBottom(closed) : rectRight(closed);
  for (const rect of sorted) {
    const start = vertical ? rect.y : rect.x;
    const rectEnd = vertical ? rectBottom(rect) : rectRight(rect);
    if (!approximatelyEqual(start, cursor)) return false;
    cursor = rectEnd;
  }
  return approximatelyEqual(cursor, end);
}

function neighborsForClosedEdge<TPanel extends PanelLayoutPanel>(
  panels: readonly RectangularPanel<TPanel>[],
  closed: LayoutRect,
  direction: LayoutDirection,
): RectangularPanel<TPanel>[] {
  return panels.filter(({ rect }) => {
    if (direction === 'left')
      return (
        approximatelyEqual(rectRight(rect), closed.x) &&
        rect.y >= closed.y - LAYOUT_GEOMETRY_EPSILON &&
        rectBottom(rect) <= rectBottom(closed) + LAYOUT_GEOMETRY_EPSILON
      );
    if (direction === 'right')
      return (
        approximatelyEqual(rect.x, rectRight(closed)) &&
        rect.y >= closed.y - LAYOUT_GEOMETRY_EPSILON &&
        rectBottom(rect) <= rectBottom(closed) + LAYOUT_GEOMETRY_EPSILON
      );
    if (direction === 'up')
      return (
        approximatelyEqual(rectBottom(rect), closed.y) &&
        rect.x >= closed.x - LAYOUT_GEOMETRY_EPSILON &&
        rectRight(rect) <= rectRight(closed) + LAYOUT_GEOMETRY_EPSILON
      );
    return (
      approximatelyEqual(rect.y, rectBottom(closed)) &&
      rect.x >= closed.x - LAYOUT_GEOMETRY_EPSILON &&
      rectRight(rect) <= rectRight(closed) + LAYOUT_GEOMETRY_EPSILON
    );
  });
}

function expandIntoClosed(
  rect: LayoutRect,
  closed: LayoutRect,
  direction: LayoutDirection,
): LayoutRect {
  if (direction === 'left')
    return { x: rect.x, y: rect.y, width: rectRight(closed) - rect.x, height: rect.height };
  if (direction === 'right')
    return { x: closed.x, y: rect.y, width: rectRight(rect) - closed.x, height: rect.height };
  if (direction === 'up')
    return { x: rect.x, y: rect.y, width: rect.width, height: rectBottom(closed) - rect.y };
  return { x: rect.x, y: closed.y, width: rect.width, height: rectBottom(rect) - closed.y };
}

function removeSlotWithSiblingPromotion<TPanel extends PanelLayoutPanel>(
  node: PanelLayoutNode<TPanel>,
  slotId: string,
): { node: PanelLayoutNode<TPanel> | null; removed: boolean; direction?: LayoutDirection } {
  if (node.kind === 'panel')
    return { node: node.id === slotId ? null : node, removed: node.id === slotId };
  const first = removeSlotWithSiblingPromotion(node.first, slotId);
  if (first.removed) {
    if (!first.node)
      return {
        node: node.second,
        removed: true,
        direction: node.axis === 'horizontal' ? 'right' : 'down',
      };
    return { node: { ...node, first: first.node }, removed: true, direction: first.direction };
  }
  const second = removeSlotWithSiblingPromotion(node.second, slotId);
  if (!second.removed) return { node, removed: false };
  if (!second.node)
    return {
      node: node.first,
      removed: true,
      direction: node.axis === 'horizontal' ? 'left' : 'up',
    };
  return { node: { ...node, second: second.node }, removed: true, direction: second.direction };
}

export function generateAutomaticCloseCandidates<
  TPanel extends PanelLayoutPanel,
  TLayout extends PanelLayout<TPanel>,
>(layout: TLayout, closedSlotId: string): LayoutCloseCandidate<TLayout>[] {
  const geometry = deriveLayoutGeometry(layout);
  const closed = geometry.slotRects.get(closedSlotId);
  if (!closed || geometry.slotRects.size <= 1) return [];
  const slots = collectPanelSlots(layout.root);
  const panels = slots
    .filter((slot) => slot.id !== closedSlotId)
    .map((slot) => ({ slot, rect: geometry.slotRects.get(slot.id)! }));
  const splitIds = collectSplitIds(layout.root);
  const candidates: LayoutCloseCandidate<TLayout>[] = [];

  for (const direction of DIRECTIONS) {
    const neighbors = neighborsForClosedEdge(panels, closed, direction);
    if (
      !tilesClosedEdge(
        neighbors.map(({ rect }) => rect),
        closed,
        direction,
      )
    )
      continue;
    const neighborIds = new Set(neighbors.map(({ slot }) => slot.id));
    const expanded = panels.map((panel) =>
      neighborIds.has(panel.slot.id)
        ? { slot: panel.slot, rect: expandIntoClosed(panel.rect, closed, direction) }
        : panel,
    );
    const root = reconstructGuillotineTree(expanded, UNIT_LAYOUT_RECT, splitIds);
    if (!root) continue;
    const candidateLayout = { ...layout, root };
    const stableKey = `edge:${direction}:${[...neighborIds].sort().join(',')}`;
    const scored = scoreCandidate(layout, candidateLayout, closedSlotId, stableKey);
    candidates.push({
      kind: 'edge-expansion',
      direction,
      layout: candidateLayout,
      ...scored,
    });
  }

  const fallback = removeSlotWithSiblingPromotion(layout.root, closedSlotId);
  if (fallback.removed && fallback.node) {
    const candidateLayout = { ...layout, root: fallback.node };
    const direction = fallback.direction ?? 'right';
    const scored = scoreCandidate(layout, candidateLayout, closedSlotId, `sibling:${direction}`);
    candidates.push({
      kind: 'sibling-fallback',
      direction,
      layout: candidateLayout,
      ...scored,
    });
  }

  const unique = new Map<string, LayoutCloseCandidate<TLayout>>();
  for (const candidate of candidates) {
    const signature = JSON.stringify(candidate.layout.root);
    const existing = unique.get(signature);
    if (!existing || compareCloseScores(candidate.score, existing.score) < 0)
      unique.set(signature, candidate);
  }
  return [...unique.values()].sort((first, second) =>
    compareCloseScores(first.score, second.score),
  );
}

export function closePanelAutomatically<
  TPanel extends PanelLayoutPanel,
  TLayout extends PanelLayout<TPanel>,
>(layout: TLayout, closedSlotId: string): TLayout | null {
  return generateAutomaticCloseCandidates(layout, closedSlotId)[0]?.layout ?? null;
}
