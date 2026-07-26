import { z } from 'zod';

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
export interface InspectorLayout {
  collapsed: boolean;
  width: number;
}

/** Narrow enough to stay a rail, wide enough to hold a member row without truncation. */
export const INSPECTOR_MIN_WIDTH = 224;
export const INSPECTOR_MAX_WIDTH = 520;
export const INSPECTOR_DEFAULT_WIDTH = 288;
/** One keyboard resize step on the split separator. */
export const INSPECTOR_WIDTH_STEP = 16;

const LAYOUT_STORAGE_PREFIX = 'coda:inspector-layout:';

export const inspectorLayoutSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().finite(),
});

export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return INSPECTOR_DEFAULT_WIDTH;
  return Math.round(Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, width)));
}

export function createDefaultInspectorLayout(): InspectorLayout {
  return { collapsed: false, width: INSPECTOR_DEFAULT_WIDTH };
}

function storageKey(scope: string): string {
  return `${LAYOUT_STORAGE_PREFIX}${scope}`;
}

/** Reads the persisted layout for a scope, falling back to the canonical default. */
export function readInspectorLayout(scope: string): InspectorLayout {
  try {
    const stored = localStorage.getItem(storageKey(scope));
    if (stored) {
      const parsed = inspectorLayoutSchema.parse(JSON.parse(stored));
      return { collapsed: parsed.collapsed, width: clampInspectorWidth(parsed.width) };
    }
  } catch {
    // Invalid or unavailable storage falls back to the canonical layout.
  }
  return createDefaultInspectorLayout();
}

export function writeInspectorLayout(scope: string, layout: InspectorLayout): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(layout));
  } catch {
    // A private or quota-limited browser still gets the in-memory layout.
  }
}
