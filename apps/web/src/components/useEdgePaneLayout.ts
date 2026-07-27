import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampEdgePaneWidth,
  readEdgePaneLayout,
  writeEdgePaneLayout,
  type EdgePaneLayout,
  type EdgePaneLayoutConfig,
} from './edge-pane-layout';

export interface EdgePaneLayoutController extends EdgePaneLayout {
  toggleCollapsed: () => void;
  /** Sets an absolute pane width; the configured bounds are always applied. */
  resizeTo: (width: number) => void;
  /** Nudges the pane width by a signed delta. */
  resizeBy: (delta: number) => void;
}

/**
 * Owns persisted collapse state and absolute width for a leading or trailing pane.
 *
 * The config object should be module-stable: pane policy belongs to the consumer,
 * while the controller and separator supply the shared behavior.
 */
export function useEdgePaneLayout(
  scope: string,
  config: EdgePaneLayoutConfig,
): EdgePaneLayoutController {
  const initial = useRef<EdgePaneLayout>(null!);
  initial.current ??= readEdgePaneLayout(scope, config);
  const [layout, setLayout] = useState<EdgePaneLayout>(() => initial.current);

  useEffect(() => {
    writeEdgePaneLayout(scope, layout, config);
  }, [config, layout, scope]);

  const toggleCollapsed = useCallback(() => {
    setLayout((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  const resizeTo = useCallback(
    (width: number) => {
      setLayout((current) => {
        const next = clampEdgePaneWidth(width, config);
        return next === current.width ? current : { ...current, width: next };
      });
    },
    [config],
  );

  const resizeBy = useCallback(
    (delta: number) => {
      resizeTo(layout.width + delta);
    },
    [layout.width, resizeTo],
  );

  return { ...layout, toggleCollapsed, resizeTo, resizeBy };
}
