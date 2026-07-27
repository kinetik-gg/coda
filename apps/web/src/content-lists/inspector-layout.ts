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
 * The persisted geometry of a content-list inspector pane. Deliberately the
 * smallest shape that survives a reload: how wide the trailing pane is, and
 * whether it is collapsed to its rail.
 *
 * Persistence mirrors the established layout pattern (see
 * `useScreenplayPanelLayout`): a validated local mirror keyed by scope, written
 * on every change, tolerant of unavailable or corrupt storage. The dashboard
 * has no per-user layout endpoint yet — the two project/screenplay layout
 * endpoints are document-scoped — so `readInspectorLayout` /
 * `writeInspectorLayout` are the single seam a later server-synced dashboard
 * layout would replace, exactly as the screenplay layout replaced its own local
 * mirror with a revisioned PUT.
 */
export type InspectorLayout = EdgePaneLayout;

/** Narrow enough to stay a rail, wide enough to hold a member row without truncation. */
export const INSPECTOR_MIN_WIDTH = 224;
export const INSPECTOR_MAX_WIDTH = 520;
export const INSPECTOR_DEFAULT_WIDTH = 288;
/** One keyboard resize step on the split separator. */
export const INSPECTOR_WIDTH_STEP = 16;

export const INSPECTOR_LAYOUT_CONFIG: EdgePaneLayoutConfig = {
  min: INSPECTOR_MIN_WIDTH,
  max: INSPECTOR_MAX_WIDTH,
  default: INSPECTOR_DEFAULT_WIDTH,
  step: INSPECTOR_WIDTH_STEP,
  storagePrefix: 'coda:inspector-layout:',
};

export const inspectorLayoutSchema = edgePaneLayoutSchema;

export function clampInspectorWidth(width: number): number {
  return clampEdgePaneWidth(width, INSPECTOR_LAYOUT_CONFIG);
}

export function createDefaultInspectorLayout(): InspectorLayout {
  return createDefaultEdgePaneLayout(INSPECTOR_LAYOUT_CONFIG);
}

/** Reads the persisted layout for a scope, falling back to the canonical default. */
export function readInspectorLayout(scope: string): InspectorLayout {
  return readEdgePaneLayout(scope, INSPECTOR_LAYOUT_CONFIG);
}

export function writeInspectorLayout(scope: string, layout: InspectorLayout): void {
  writeEdgePaneLayout(scope, layout, INSPECTOR_LAYOUT_CONFIG);
}
