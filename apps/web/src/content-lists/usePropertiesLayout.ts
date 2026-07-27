import { useEdgePaneLayout, type EdgePaneLayoutController } from '../components/useEdgePaneLayout';
import { PROPERTIES_LAYOUT_CONFIG } from './properties-layout';

export type PropertiesLayoutController = EdgePaneLayoutController;

/**
 * Owns the collapse state and width of one properties pane, persisted per scope
 * so both survive a reload. `scope` is the list identity (for example
 * `screenplays`), not the selected row: the pane geometry belongs to the
 * surface, and selection is a separate concern.
 */
export function usePropertiesLayout(scope: string): PropertiesLayoutController {
  return useEdgePaneLayout(scope, PROPERTIES_LAYOUT_CONFIG);
}
