import type { ReactNode } from 'react';
import {
  InspectorSplit,
  useInspectorLayout,
  useRowSelection,
  type ContextMenuItem,
} from '../../content-lists';
import type { Project } from '../types';
import { BreakdownInspector } from './BreakdownInspector';

const breakdownKey = (project: Project) => project.id;
const NO_ACTIONS: readonly ContextMenuItem[] = [];

/** What the hosted tables need in order to drive and reflect the pane. */
export interface BreakdownSelectionProps {
  isSelected: (project: Project) => boolean;
  onSelect: (project: Project) => void;
}

/**
 * The breakdowns list beside its inspector pane: drop-in replacement for `ScrollBody` on the
 * breakdowns surface.
 *
 * The screenplays surface hosts one list; breakdowns may host two ("Your work" and "Shared with
 * you"), so selection is owned here over the *combined* rows and handed to both lists. Selecting in
 * one section therefore deselects in the other, and the pane always reflects exactly one row.
 *
 * `buildMenu` is the same builder the tables pass to `DataTable`, which is what keeps the pane's
 * quick actions and the row context menu one vocabulary with one set of handlers.
 */
export function BreakdownInspectorSplit({
  rows,
  buildMenu,
  scope = 'breakdowns',
  children,
}: {
  rows: readonly Project[];
  buildMenu: (project: Project) => ContextMenuItem[];
  /** The persistence scope for collapse state and width; one per list surface. */
  scope?: string;
  children: (selection: BreakdownSelectionProps) => ReactNode;
}) {
  const layout = useInspectorLayout(scope);
  const selection = useRowSelection({ rows, rowKey: breakdownKey });
  const selected = selection.selected;

  return (
    <InspectorSplit
      width={layout.width}
      collapsed={layout.collapsed}
      onResize={layout.resizeTo}
      onToggleCollapsed={layout.toggleCollapsed}
      inspector={
        <BreakdownInspector
          breakdown={selected}
          actions={selected ? buildMenu(selected) : NO_ACTIONS}
          width={layout.width}
          collapsed={layout.collapsed}
          onToggleCollapsed={layout.toggleCollapsed}
        />
      }
    >
      {children({ isSelected: selection.isSelected, onSelect: selection.select })}
    </InspectorSplit>
  );
}
