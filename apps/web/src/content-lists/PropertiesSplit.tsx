import { useRef, type ReactNode } from 'react';
import { EdgePaneSeparator } from '../components/EdgePaneSeparator';
import { PROPERTIES_LAYOUT_CONFIG } from './properties-layout';
import styles from './Properties.module.css';

/**
 * The two-region split that hosts a content list beside its properties pane.
 *
 * Both regions scroll internally and the frame itself never grows: the split is
 * a fixed grid inside the dashboard content frame, so no page-level scrolling is
 * introduced. Use it in place of `ScrollBody` on a list that has properties.
 *
 * **The pane is absent, not empty, when nothing is selected** (#193). An earlier
 * revision always rendered it and filled it with a "select something" sentence,
 * which spent a third of the plane explaining that it had nothing to say. With
 * no subject there is no pane and no separator, and the list gets the width.
 *
 * The drag handle is a real `separator` with a resize value, operable by pointer
 * and by keyboard: Left/Right nudge the pane by one step, Home/End jump to the
 * pane bounds, and Enter/Space collapse or restore it.
 */
export function PropertiesSplit({
  width,
  collapsed,
  onResize,
  onToggleCollapsed,
  separatorLabel = 'Resize properties',
  properties,
  children,
}: {
  width: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggleCollapsed: () => void;
  separatorLabel?: string;
  /** Omit (or pass nothing) when no row is selected — the pane will not render. */
  properties?: ReactNode;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const showPane = properties !== undefined && properties !== null && properties !== false;

  return (
    <div ref={frameRef} className={styles.split}>
      <div className={styles.primary}>{children}</div>
      {showPane && !collapsed && (
        <EdgePaneSeparator
          edge="trailing"
          frameRef={frameRef}
          width={width}
          config={PROPERTIES_LAYOUT_CONFIG}
          className={styles.separator}
          label={separatorLabel}
          onResize={onResize}
          onToggleCollapsed={onToggleCollapsed}
        />
      )}
      {showPane ? properties : null}
    </div>
  );
}
