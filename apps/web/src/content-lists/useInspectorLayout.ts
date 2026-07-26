import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampInspectorWidth,
  readInspectorLayout,
  writeInspectorLayout,
  type InspectorLayout,
} from './inspector-layout';

export interface InspectorLayoutController extends InspectorLayout {
  toggleCollapsed: () => void;
  /** Sets an absolute pane width (pointer drag); clamped to the pane bounds. */
  resizeTo: (width: number) => void;
  /** Nudges the pane width by a signed delta (keyboard resize on the separator). */
  resizeBy: (delta: number) => void;
}

/**
 * Owns the collapse state and width of one inspector pane, persisted per scope
 * so both survive a reload. `scope` is the list identity (for example
 * `screenplays`), not the selected row: the pane geometry belongs to the
 * surface, and selection is a separate concern.
 */
export function useInspectorLayout(scope: string): InspectorLayoutController {
  const initial = useRef<InspectorLayout>(null!);
  initial.current ??= readInspectorLayout(scope);
  const [layout, setLayout] = useState<InspectorLayout>(() => initial.current);

  // Keep the persisted mirror warm on every change. Replacing this effect with a
  // revisioned PUT is all a server-synced dashboard layout would need.
  useEffect(() => {
    writeInspectorLayout(scope, layout);
  }, [scope, layout]);

  const toggleCollapsed = useCallback(() => {
    setLayout((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  const resizeTo = useCallback((width: number) => {
    setLayout((current) => {
      const next = clampInspectorWidth(width);
      return next === current.width ? current : { ...current, width: next };
    });
  }, []);

  const resizeBy = useCallback(
    (delta: number) => {
      resizeTo(layout.width + delta);
    },
    [layout.width, resizeTo],
  );

  return { ...layout, toggleCollapsed, resizeTo, resizeBy };
}
