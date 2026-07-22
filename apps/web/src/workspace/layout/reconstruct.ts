import type { WorkspaceLayoutNode, WorkspacePanelSlot, WorkspaceSplitNode } from '@coda/contracts';
import {
  LAYOUT_GEOMETRY_EPSILON,
  approximatelyEqual,
  rectBottom,
  rectContains,
  rectRight,
} from './geometry';
import type { LayoutRect } from './model';

export interface RectangularPanel {
  slot: WorkspacePanelSlot;
  rect: LayoutRect;
}

interface Reconstructed {
  node: WorkspaceLayoutNode;
  nextSplitIdIndex: number;
}

function overlaps(first: LayoutRect, second: LayoutRect, epsilon: number): boolean {
  return (
    Math.min(rectRight(first), rectRight(second)) - Math.max(first.x, second.x) > epsilon &&
    Math.min(rectBottom(first), rectBottom(second)) - Math.max(first.y, second.y) > epsilon
  );
}

function validPartition(
  panels: readonly RectangularPanel[],
  bounds: LayoutRect,
  epsilon: number,
): boolean {
  if (!panels.length || panels.some(({ rect }) => !rectContains(bounds, rect, epsilon)))
    return false;
  for (let first = 0; first < panels.length; first += 1) {
    for (let second = first + 1; second < panels.length; second += 1) {
      if (overlaps(panels[first]!.rect, panels[second]!.rect, epsilon)) return false;
    }
  }
  const coveredArea = panels.reduce((sum, { rect }) => sum + rect.width * rect.height, 0);
  return approximatelyEqual(coveredArea, bounds.width * bounds.height, epsilon * 4);
}

function possibleCuts(
  panels: readonly RectangularPanel[],
  bounds: LayoutRect,
  epsilon: number,
): Array<{ axis: 'horizontal' | 'vertical'; coordinate: number }> {
  const cuts: Array<{ axis: 'horizontal' | 'vertical'; coordinate: number }> = [];
  const xCoordinates = new Set<number>();
  const yCoordinates = new Set<number>();
  for (const { rect } of panels) {
    if (rect.x > bounds.x + epsilon) xCoordinates.add(rect.x);
    if (rectRight(rect) < rectRight(bounds) - epsilon) xCoordinates.add(rectRight(rect));
    if (rect.y > bounds.y + epsilon) yCoordinates.add(rect.y);
    if (rectBottom(rect) < rectBottom(bounds) - epsilon) yCoordinates.add(rectBottom(rect));
  }
  for (const coordinate of [...xCoordinates].sort((a, b) => a - b)) {
    if (
      panels.every(
        ({ rect }) => rectRight(rect) <= coordinate + epsilon || rect.x >= coordinate - epsilon,
      )
    )
      cuts.push({ axis: 'horizontal', coordinate });
  }
  for (const coordinate of [...yCoordinates].sort((a, b) => a - b)) {
    if (
      panels.every(
        ({ rect }) => rectBottom(rect) <= coordinate + epsilon || rect.y >= coordinate - epsilon,
      )
    )
      cuts.push({ axis: 'vertical', coordinate });
  }
  return cuts.sort((first, second) => {
    const firstDistance =
      first.axis === 'horizontal'
        ? Math.abs(first.coordinate - (bounds.x + bounds.width / 2)) / bounds.width
        : Math.abs(first.coordinate - (bounds.y + bounds.height / 2)) / bounds.height;
    const secondDistance =
      second.axis === 'horizontal'
        ? Math.abs(second.coordinate - (bounds.x + bounds.width / 2)) / bounds.width
        : Math.abs(second.coordinate - (bounds.y + bounds.height / 2)) / bounds.height;
    return firstDistance - secondDistance || first.axis.localeCompare(second.axis);
  });
}

function reconstruct(
  panels: readonly RectangularPanel[],
  bounds: LayoutRect,
  splitIds: readonly string[],
  splitIdIndex: number,
  epsilon: number,
): Reconstructed | null {
  if (panels.length === 1) return { node: panels[0]!.slot, nextSplitIdIndex: splitIdIndex };
  for (const cut of possibleCuts(panels, bounds, epsilon)) {
    const firstPanels = panels.filter(({ rect }) =>
      cut.axis === 'horizontal'
        ? rectRight(rect) <= cut.coordinate + epsilon
        : rectBottom(rect) <= cut.coordinate + epsilon,
    );
    const secondPanels = panels.filter(({ rect }) =>
      cut.axis === 'horizontal'
        ? rect.x >= cut.coordinate - epsilon
        : rect.y >= cut.coordinate - epsilon,
    );
    if (!firstPanels.length || !secondPanels.length) continue;
    const ratio =
      cut.axis === 'horizontal'
        ? (cut.coordinate - bounds.x) / bounds.width
        : (cut.coordinate - bounds.y) / bounds.height;
    const ratioBasisPoints = Math.round(ratio * 10_000);
    if (ratioBasisPoints < 500 || ratioBasisPoints > 9500) continue;
    const firstBounds: LayoutRect =
      cut.axis === 'horizontal'
        ? { x: bounds.x, y: bounds.y, width: cut.coordinate - bounds.x, height: bounds.height }
        : { x: bounds.x, y: bounds.y, width: bounds.width, height: cut.coordinate - bounds.y };
    const secondBounds: LayoutRect =
      cut.axis === 'horizontal'
        ? {
            x: cut.coordinate,
            y: bounds.y,
            width: rectRight(bounds) - cut.coordinate,
            height: bounds.height,
          }
        : {
            x: bounds.x,
            y: cut.coordinate,
            width: bounds.width,
            height: rectBottom(bounds) - cut.coordinate,
          };
    const id = splitIds[splitIdIndex];
    if (!id) return null;
    const first = reconstruct(firstPanels, firstBounds, splitIds, splitIdIndex + 1, epsilon);
    if (!first) continue;
    const second = reconstruct(
      secondPanels,
      secondBounds,
      splitIds,
      first.nextSplitIdIndex,
      epsilon,
    );
    if (!second) continue;
    const node: WorkspaceSplitNode = {
      kind: 'split',
      id,
      axis: cut.axis,
      ratioBasisPoints,
      first: first.node,
      second: second.node,
    };
    return { node, nextSplitIdIndex: second.nextSplitIdIndex };
  }
  return null;
}

export function reconstructGuillotineTree(
  panels: readonly RectangularPanel[],
  bounds: LayoutRect,
  splitIds: readonly string[],
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): WorkspaceLayoutNode | null {
  if (!validPartition(panels, bounds, epsilon)) return null;
  return reconstruct(panels, bounds, splitIds, 0, epsilon)?.node ?? null;
}
