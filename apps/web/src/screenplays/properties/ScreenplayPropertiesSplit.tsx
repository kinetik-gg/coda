import type { ReactNode } from 'react';
import {
  PropertiesSplit,
  usePropertiesLayout,
  useRowSelection,
  useSettledValue,
  type ContextMenuItem,
} from '../../content-lists';
import type { ScreenplaySummary } from '../types';
import { ScreenplayProperties } from './ScreenplayProperties';

/**
 * The selection settle window. It lives here rather than in the pane because the pane
 * unmounts when nothing is selected (#193), and a debounce that remounts forgets its history.
 */
const SELECTION_SETTLE_MS = 200;

const screenplayKey = (screenplay: ScreenplaySummary) => screenplay.id;

/** What the hosted table needs in order to drive and reflect the pane. */
export interface ScreenplaySelectionProps {
  isSelected: (screenplay: ScreenplaySummary) => boolean;
  onSelect: (screenplay: ScreenplaySummary) => void;
}

/**
 * The screenplays list beside its properties: drop-in replacement for `ScrollBody`
 * on a screenplay content list. It owns the selection model and the persisted
 * pane geometry so the host screen only supplies its rows, its row-menu builder,
 * and its table.
 *
 * `buildMenu` is the *same* builder the table passes to `DataTable`, which is
 * what keeps the pane's quick actions and the row context menu one vocabulary
 * with one set of handlers.
 */
export function ScreenplayPropertiesSplit({
  rows,
  buildMenu,
  scope = 'screenplays',
  renderPresence,
  children,
}: {
  rows: readonly ScreenplaySummary[];
  buildMenu: (screenplay: ScreenplaySummary) => ContextMenuItem[];
  /** The persistence scope for collapse state and width; one per list surface. */
  scope?: string;
  /**
   * Extension point for #155 collaborative presence: return the presence roster
   * for the selected screenplay and it renders in the pane's presence slot,
   * between the identity block and the metadata section. The id is handed in so
   * the subscription lives with the transport, not in the pane.
   */
  renderPresence?: (screenplayId: string) => ReactNode;
  children: (selection: ScreenplaySelectionProps) => ReactNode;
}) {
  const layout = usePropertiesLayout(scope);
  const selection = useRowSelection({ rows, rowKey: screenplayKey });
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
          <ScreenplayProperties
            screenplay={selected}
            screenplayId={settledId}
            actions={buildMenu(selected)}
            width={layout.width}
            collapsed={layout.collapsed}
            onToggleCollapsed={layout.toggleCollapsed}
            presence={renderPresence?.(selected.id)}
          />
        ) : undefined
      }
    >
      {children({ isSelected: selection.isSelected, onSelect: selection.select })}
    </PropertiesSplit>
  );
}
