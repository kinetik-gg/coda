import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH, INSPECTOR_WIDTH_STEP } from './inspector-layout';
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
  const [dragging, setDragging] = useState(false);

  const widthFromPointer = (clientX: number) => {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return width;
    return bounds.right - clientX;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onResize(widthFromPointer(event.clientX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        onResize(width + INSPECTOR_WIDTH_STEP);
        break;
      case 'ArrowRight':
        event.preventDefault();
        onResize(width - INSPECTOR_WIDTH_STEP);
        break;
      case 'Home':
        event.preventDefault();
        onResize(INSPECTOR_MIN_WIDTH);
        break;
      case 'End':
        event.preventDefault();
        onResize(INSPECTOR_MAX_WIDTH);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onToggleCollapsed();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={frameRef} className={styles.split}>
      <div className={styles.primary}>{children}</div>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={separatorLabel}
          aria-valuenow={width}
          aria-valuemin={INSPECTOR_MIN_WIDTH}
          aria-valuemax={INSPECTOR_MAX_WIDTH}
          tabIndex={0}
          data-dragging={dragging}
          className={styles.separator}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        />
      )}
      {inspector}
    </div>
  );
}
