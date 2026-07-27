import { useEdgePaneLayout, type EdgePaneLayoutController } from '../components/useEdgePaneLayout';
import { INSPECTOR_LAYOUT_CONFIG } from './inspector-layout';

export type InspectorLayoutController = EdgePaneLayoutController;

/**
 * Owns the collapse state and width of one inspector pane, persisted per scope
 * so both survive a reload. `scope` is the list identity (for example
 * `screenplays`), not the selected row: the pane geometry belongs to the
 * surface, and selection is a separate concern.
 */
export function useInspectorLayout(scope: string): InspectorLayoutController {
  return useEdgePaneLayout(scope, INSPECTOR_LAYOUT_CONFIG);
}
