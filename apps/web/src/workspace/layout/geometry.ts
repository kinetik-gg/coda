import type { LayoutAdjacency, LayoutDirection, LayoutGeometry, LayoutRect } from './model';
import type { PanelLayout, PanelLayoutNode, PanelLayoutPanel } from './primitives';

export const LAYOUT_GEOMETRY_EPSILON = 1e-8;

export const UNIT_LAYOUT_RECT: LayoutRect = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

export function rectRight(rect: LayoutRect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: LayoutRect): number {
  return rect.y + rect.height;
}

export function approximatelyEqual(
  first: number,
  second: number,
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): boolean {
  return Math.abs(first - second) <= epsilon;
}

export function deriveLayoutGeometry<TPanel extends PanelLayoutPanel>(
  layout: PanelLayout<TPanel>,
  bounds: LayoutRect = UNIT_LAYOUT_RECT,
): LayoutGeometry {
  const nodeRects = new Map<string, LayoutRect>();
  const slotRects = new Map<string, LayoutRect>();

  const visit = (node: PanelLayoutNode<TPanel>, rect: LayoutRect): void => {
    const frozenRect = Object.freeze({ ...rect });
    nodeRects.set(node.id, frozenRect);
    if (node.kind === 'panel') {
      slotRects.set(node.id, frozenRect);
      return;
    }

    const fraction = node.ratioBasisPoints / 10_000;
    if (node.axis === 'horizontal') {
      const firstWidth = rect.width * fraction;
      visit(node.first, { x: rect.x, y: rect.y, width: firstWidth, height: rect.height });
      visit(node.second, {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      });
    } else {
      const firstHeight = rect.height * fraction;
      visit(node.first, { x: rect.x, y: rect.y, width: rect.width, height: firstHeight });
      visit(node.second, {
        x: rect.x,
        y: rect.y + firstHeight,
        width: rect.width,
        height: rect.height - firstHeight,
      });
    }
  };

  visit(layout.root, bounds);
  return { bounds: Object.freeze({ ...bounds }), nodeRects, slotRects };
}

export function sharedEdgeInDirection(
  from: LayoutRect,
  to: LayoutRect,
  direction: LayoutDirection,
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): number {
  if (direction === 'left' || direction === 'right') {
    const touches =
      direction === 'left'
        ? approximatelyEqual(to.x + to.width, from.x, epsilon)
        : approximatelyEqual(from.x + from.width, to.x, epsilon);
    if (!touches) return 0;
    return Math.max(0, Math.min(rectBottom(from), rectBottom(to)) - Math.max(from.y, to.y));
  }

  const touches =
    direction === 'up'
      ? approximatelyEqual(to.y + to.height, from.y, epsilon)
      : approximatelyEqual(from.y + from.height, to.y, epsilon);
  if (!touches) return 0;
  return Math.max(0, Math.min(rectRight(from), rectRight(to)) - Math.max(from.x, to.x));
}

export function deriveAdjacency<TPanel extends PanelLayoutPanel>(
  layout: PanelLayout<TPanel>,
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): LayoutAdjacency[] {
  const geometry = deriveLayoutGeometry(layout);
  const entries = [...geometry.slotRects.entries()];
  const directions: LayoutDirection[] = ['left', 'right', 'up', 'down'];
  const result: LayoutAdjacency[] = [];
  for (const [fromSlotId, from] of entries) {
    for (const [toSlotId, to] of entries) {
      if (fromSlotId === toSlotId) continue;
      for (const direction of directions) {
        const sharedEdge = sharedEdgeInDirection(from, to, direction, epsilon);
        if (sharedEdge > epsilon) result.push({ fromSlotId, toSlotId, direction, sharedEdge });
      }
    }
  }
  return result;
}

export function rectsApproximatelyEqual(
  first: LayoutRect,
  second: LayoutRect,
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): boolean {
  return (
    approximatelyEqual(first.x, second.x, epsilon) &&
    approximatelyEqual(first.y, second.y, epsilon) &&
    approximatelyEqual(first.width, second.width, epsilon) &&
    approximatelyEqual(first.height, second.height, epsilon)
  );
}

export function rectContains(
  outer: LayoutRect,
  inner: LayoutRect,
  epsilon = LAYOUT_GEOMETRY_EPSILON,
): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    rectRight(inner) <= rectRight(outer) + epsilon &&
    rectBottom(inner) <= rectBottom(outer) + epsilon
  );
}
