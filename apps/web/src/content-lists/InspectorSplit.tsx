import { useRef, type ReactNode } from 'react';
import { EdgePaneSeparator } from '../components/EdgePaneSeparator';
import { INSPECTOR_LAYOUT_CONFIG } from './inspector-layout';
import styles from './Inspector.module.css';

/**
 * The two-region split that hosts a content list beside its inspector pane.
 *
 * Both regions scroll internally and the frame itself never grows: the split is
 * a fixed grid inside the dashboard content frame, so no page-level scrolling is
 * introduced. Use it in place of `ScrollBody` on a list that has an inspector.
 *
 * The drag handle is a real `separator` with a resize value, operable by pointer
 * and by keyboard: Left/Right nudge the pane by one step, Home/End jump to the
 * pane bounds, and Enter/Space collapse or restore it.
 */
export function InspectorSplit({
  width,
  collapsed,
  onResize,
  onToggleCollapsed,
  separatorLabel = 'Resize inspector',
  inspector,
  children,
}: {
  width: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggleCollapsed: () => void;
  separatorLabel?: string;
  inspector: ReactNode;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={frameRef} className={styles.split}>
      <div className={styles.primary}>{children}</div>
      {!collapsed && (
        <EdgePaneSeparator
          edge="trailing"
          frameRef={frameRef}
          width={width}
          config={INSPECTOR_LAYOUT_CONFIG}
          className={styles.separator}
          label={separatorLabel}
          onResize={onResize}
          onToggleCollapsed={onToggleCollapsed}
        />
      )}
      {inspector}
    </div>
  );
}
