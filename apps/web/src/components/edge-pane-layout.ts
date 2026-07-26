import { z } from 'zod';

/** Geometry and persistence policy for one fixed-width window-edge pane. */
export interface EdgePaneLayoutConfig {
  min: number;
  max: number;
  default: number;
  step: number;
  storagePrefix: string;
}

export interface EdgePaneLayout {
  collapsed: boolean;
  width: number;
}

export const edgePaneLayoutSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().finite(),
});

export function clampEdgePaneWidth(width: number, config: EdgePaneLayoutConfig): number {
  if (!Number.isFinite(width)) return config.default;
  return Math.round(Math.min(config.max, Math.max(config.min, width)));
}

export function createDefaultEdgePaneLayout(config: EdgePaneLayoutConfig): EdgePaneLayout {
  return { collapsed: false, width: config.default };
}

function storageKey(scope: string, config: EdgePaneLayoutConfig): string {
  return `${config.storagePrefix}${scope}`;
}

/** Reads a persisted pane layout, falling back when storage is unavailable or invalid. */
export function readEdgePaneLayout(scope: string, config: EdgePaneLayoutConfig): EdgePaneLayout {
  try {
    const stored = localStorage.getItem(storageKey(scope, config));
    if (stored) {
      const parsed = edgePaneLayoutSchema.parse(JSON.parse(stored));
      return {
        collapsed: parsed.collapsed,
        width: clampEdgePaneWidth(parsed.width, config),
      };
    }
  } catch {
    // Invalid or unavailable storage falls back to the configured layout.
  }
  return createDefaultEdgePaneLayout(config);
}

export function writeEdgePaneLayout(
  scope: string,
  layout: EdgePaneLayout,
  config: EdgePaneLayoutConfig,
): void {
  try {
    localStorage.setItem(storageKey(scope, config), JSON.stringify(layout));
  } catch {
    // A private or quota-limited browser still gets the in-memory layout.
  }
}
