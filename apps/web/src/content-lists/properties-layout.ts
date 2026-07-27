import {
  clampEdgePaneWidth,
  createDefaultEdgePaneLayout,
  edgePaneLayoutSchema,
  readEdgePaneLayout,
  writeEdgePaneLayout,
  type EdgePaneLayout,
  type EdgePaneLayoutConfig,
} from '../components/edge-pane-layout';

/**
 * The persisted geometry of a content-list properties pane. Deliberately the
 * smallest shape that survives a reload: how wide the trailing pane is, and
 * whether it is collapsed to its rail.
 *
 * Persistence mirrors the established layout pattern (see
 * `useScreenplayPanelLayout`): a validated local mirror keyed by scope, written
 * on every change, tolerant of unavailable or corrupt storage. The dashboard
 * has no per-user layout endpoint yet — the two project/screenplay layout
 * endpoints are document-scoped — so `readPropertiesLayout` /
 * `writePropertiesLayout` are the single seam a later server-synced dashboard
 * layout would replace, exactly as the screenplay layout replaced its own local
 * mirror with a revisioned PUT.
 */
export type PropertiesLayout = EdgePaneLayout;

/** Narrow enough to stay a rail, wide enough to hold a member row without truncation. */
export const PROPERTIES_MIN_WIDTH = 224;
export const PROPERTIES_MAX_WIDTH = 520;
export const PROPERTIES_DEFAULT_WIDTH = 288;
/** One keyboard resize step on the split separator. */
export const PROPERTIES_WIDTH_STEP = 16;

export const PROPERTIES_LAYOUT_CONFIG: EdgePaneLayoutConfig = {
  min: PROPERTIES_MIN_WIDTH,
  max: PROPERTIES_MAX_WIDTH,
  default: PROPERTIES_DEFAULT_WIDTH,
  step: PROPERTIES_WIDTH_STEP,
  storagePrefix: 'coda:properties-layout:',
};

export const propertiesLayoutSchema = edgePaneLayoutSchema;

export function clampPropertiesWidth(width: number): number {
  return clampEdgePaneWidth(width, PROPERTIES_LAYOUT_CONFIG);
}

export function createDefaultPropertiesLayout(): PropertiesLayout {
  return createDefaultEdgePaneLayout(PROPERTIES_LAYOUT_CONFIG);
}

/** Reads the persisted layout for a scope, falling back to the canonical default. */
export function readPropertiesLayout(scope: string): PropertiesLayout {
  return readEdgePaneLayout(scope, PROPERTIES_LAYOUT_CONFIG);
}

export function writePropertiesLayout(scope: string, layout: PropertiesLayout): void {
  writeEdgePaneLayout(scope, layout, PROPERTIES_LAYOUT_CONFIG);
}
