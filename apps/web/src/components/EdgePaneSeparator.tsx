import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { EdgePaneLayoutConfig } from './edge-pane-layout';

export type EdgePane = 'leading' | 'trailing';

/**
 * Pointer- and keyboard-operable separator shared by fixed-width edge panes.
 *
 * Arrow direction follows the physical edge: Right grows a leading pane, while
 * Left grows a trailing pane. Home/End always mean minimum/maximum width.
 */
export function EdgePaneSeparator({
  edge,
  frameRef,
  width,
  config,
  className,
  label,
  onResize,
  onToggleCollapsed,
}: {
  edge: EdgePane;
  frameRef: RefObject<HTMLElement | null>;
  width: number;
  config: EdgePaneLayoutConfig;
  className?: string;
  label: string;
  onResize: (width: number) => void;
  onToggleCollapsed?: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  const widthFromPointer = (clientX: number) => {
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return width;
    return edge === 'leading' ? clientX - bounds.left : bounds.right - clientX;
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
    const growKey = edge === 'leading' ? 'ArrowRight' : 'ArrowLeft';
    const shrinkKey = edge === 'leading' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === growKey) {
      event.preventDefault();
      onResize(width + config.step);
    } else if (event.key === shrinkKey) {
      event.preventDefault();
      onResize(width - config.step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onResize(config.min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(config.max);
    } else if ((event.key === 'Enter' || event.key === ' ') && onToggleCollapsed) {
      event.preventDefault();
      onToggleCollapsed();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={config.min}
      aria-valuemax={config.max}
      tabIndex={0}
      data-dragging={dragging}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
