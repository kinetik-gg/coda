import type { ReactNode } from 'react';
import {
  PropertiesSplit,
  usePropertiesLayout,
  useRowSelection,
  useSettledValue,
  type ContextMenuItem,
} from '../../content-lists';
import type { Project } from '../types';
import { BreakdownProperties } from './BreakdownProperties';

/**
 * The selection settle window. It lives here rather than in the pane because the pane
 * unmounts when nothing is selected (#193), and a debounce that remounts forgets its history.
 */
const SELECTION_SETTLE_MS = 200;

const breakdownKey = (project: Project) => project.id;

/** What the hosted tables need in order to drive and reflect the pane. */
export interface BreakdownSelectionProps {
  isSelected: (project: Project) => boolean;
  onSelect: (project: Project) => void;
}

/**
 * The breakdowns list beside its properties pane: drop-in replacement for `ScrollBody` on the
 * breakdowns surface.
 *
 * The screenplays surface hosts one list; breakdowns may host two ("Your work" and "Shared with
 * you"), so selection is owned here over the *combined* rows and handed to both lists. Selecting in
 * one section therefore deselects in the other, and the pane always reflects exactly one row.
 *
 * `buildMenu` is the same builder the tables pass to `DataTable`, which is what keeps the pane's
 * quick actions and the row context menu one vocabulary with one set of handlers.
 */
export function BreakdownPropertiesSplit({
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
  const layout = usePropertiesLayout(scope);
  const selection = useRowSelection({ rows, rowKey: breakdownKey });
  const selected = selection.selected;
  const settledId = useSettledValue(selected?.id, SELECTION_SETTLE_MS);

  return (
    <PropertiesSplit
      width={layout.width}
      collapsed={layout.collapsed}
      onResize={layout.resizeTo}
      onToggleCollapsed={layout.toggleCollapsed}
      properties={
        selected ? (
          <BreakdownProperties
            breakdown={selected}
            breakdownId={settledId}
            actions={buildMenu(selected)}
            width={layout.width}
            collapsed={layout.collapsed}
            onToggleCollapsed={layout.toggleCollapsed}
          />
        ) : undefined
      }
    >
      {children({ isSelected: selection.isSelected, onSelect: selection.select })}
    </PropertiesSplit>
  );
}
