import {
  LAYOUT_GEOMETRY_EPSILON,
  approximatelyEqual,
  deriveLayoutGeometry,
  rectBottom,
  rectRight,
} from './geometry';
import type { LayoutDirection, LayoutRect } from './model';
import type { PanelLayout, PanelLayoutNode, PanelLayoutPanel } from './primitives';

interface JoinResult<TPanel extends PanelLayoutPanel> {
  node: PanelLayoutNode<TPanel>;
  found: boolean;
  joined: boolean;
}

function touchesOuterBoundary(
  slotRect: LayoutRect,
  containingChildRect: LayoutRect,
  direction: LayoutDirection,
): boolean {
  if (direction === 'left') return approximatelyEqual(slotRect.x, containingChildRect.x);
  if (direction === 'right')
    return approximatelyEqual(rectRight(slotRect), rectRight(containingChildRect));
  if (direction === 'up') return approximatelyEqual(slotRect.y, containingChildRect.y);
  return approximatelyEqual(rectBottom(slotRect), rectBottom(containingChildRect));
}

export function joinPanelDirectionally<
  TPanel extends PanelLayoutPanel,
  TLayout extends PanelLayout<TPanel>,
>(layout: TLayout, slotId: string, direction: LayoutDirection): TLayout | null {
  const geometry = deriveLayoutGeometry(layout);
  const slotRect = geometry.slotRects.get(slotId);
  if (!slotRect) return null;

  const visit = (node: PanelLayoutNode<TPanel>): JoinResult<TPanel> => {
    if (node.kind === 'panel') return { node, found: node.id === slotId, joined: false };
    const firstResult = visit(node.first);
    if (firstResult.joined)
      return { node: { ...node, first: firstResult.node }, found: true, joined: true };
    if (firstResult.found) {
      const expectedDirection = node.axis === 'horizontal' ? 'right' : 'down';
      const childRect = geometry.nodeRects.get(node.first.id)!;
      if (direction === expectedDirection && touchesOuterBoundary(slotRect, childRect, direction))
        return { node: firstResult.node, found: true, joined: true };
      return { node: { ...node, first: firstResult.node }, found: true, joined: false };
    }

    const secondResult = visit(node.second);
    if (secondResult.joined)
      return { node: { ...node, second: secondResult.node }, found: true, joined: true };
    if (secondResult.found) {
      const expectedDirection = node.axis === 'horizontal' ? 'left' : 'up';
      const childRect = geometry.nodeRects.get(node.second.id)!;
      if (direction === expectedDirection && touchesOuterBoundary(slotRect, childRect, direction))
        return { node: secondResult.node, found: true, joined: true };
      return { node: { ...node, second: secondResult.node }, found: true, joined: false };
    }
    return { node, found: false, joined: false };
  };

  const result = visit(layout.root);
  if (!result.joined) return null;
  const joinedLayout = { ...layout, root: result.node };
  const joinedGeometry = deriveLayoutGeometry(joinedLayout);
  const joinedRect = joinedGeometry.slotRects.get(slotId);
  if (!joinedRect || joinedRect.width <= LAYOUT_GEOMETRY_EPSILON) return null;
  return joinedLayout;
}
