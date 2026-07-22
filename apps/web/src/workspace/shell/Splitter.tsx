import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import styles from './WorkspaceShell.module.css';

const MIN_RATIO = 500;
const MAX_RATIO = 9500;
const KEYBOARD_STEP = 250;
const GUTTER_PIXELS = 2;

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(value)));
}

function applyPreview(
  container: HTMLDivElement,
  axis: 'horizontal' | 'vertical',
  ratioBasisPoints: number,
): void {
  const tracks = `${String(ratioBasisPoints)}fr ${String(GUTTER_PIXELS)}px ${String(10_000 - ratioBasisPoints)}fr`;
  if (axis === 'horizontal') container.style.gridTemplateColumns = tracks;
  else container.style.gridTemplateRows = tracks;
}

export function Splitter({
  axis,
  ratioBasisPoints,
  containerRef,
  onCommit,
}: {
  axis: 'horizontal' | 'vertical';
  ratioBasisPoints: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onCommit: (ratioBasisPoints: number) => void;
}) {
  const dragging = useRef(false);
  const lastRatio = useRef(ratioBasisPoints);
  const latestPointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const animationFrame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (container && !dragging.current) applyPreview(container, axis, ratioBasisPoints);
    lastRatio.current = ratioBasisPoints;
  }, [axis, containerRef, ratioBasisPoints]);

  useEffect(
    () => () => {
      if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
    },
    [],
  );

  const updateFromPointer = () => {
    animationFrame.current = undefined;
    const container = containerRef.current;
    const pointer = latestPointer.current;
    if (!container || !pointer) return;
    const bounds = container.getBoundingClientRect();
    const available =
      axis === 'horizontal' ? bounds.width - GUTTER_PIXELS : bounds.height - GUTTER_PIXELS;
    if (available <= 0) return;
    const offset =
      axis === 'horizontal'
        ? pointer.x - bounds.left - GUTTER_PIXELS / 2
        : pointer.y - bounds.top - GUTTER_PIXELS / 2;
    const ratio = clampRatio((offset / available) * 10_000);
    lastRatio.current = ratio;
    applyPreview(container, axis, ratio);
  };

  const schedulePointerUpdate = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    latestPointer.current = { x: event.clientX, y: event.clientY };
    if (animationFrame.current === undefined)
      animationFrame.current = requestAnimationFrame(updateFromPointer);
  };

  const cancelDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (animationFrame.current !== undefined) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = undefined;
    }
    const container = containerRef.current;
    if (container) applyPreview(container, axis, ratioBasisPoints);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    latestPointer.current = { x: event.clientX, y: event.clientY };
    if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
    updateFromPointer();
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (lastRatio.current !== ratioBasisPoints) onCommit(lastRatio.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined;
    if (event.key === 'Home') next = MIN_RATIO;
    else if (event.key === 'End') next = MAX_RATIO;
    else if (event.key === 'Enter') next = 5000;
    else if (
      (axis === 'horizontal' && event.key === 'ArrowLeft') ||
      (axis === 'vertical' && event.key === 'ArrowUp')
    )
      next = clampRatio(ratioBasisPoints - KEYBOARD_STEP);
    else if (
      (axis === 'horizontal' && event.key === 'ArrowRight') ||
      (axis === 'vertical' && event.key === 'ArrowDown')
    )
      next = clampRatio(ratioBasisPoints + KEYBOARD_STEP);
    if (next === undefined || next === ratioBasisPoints) return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div
      className={`${styles.splitter} ${axis === 'horizontal' ? styles.verticalSplitter : styles.horizontalSplitter}`}
      role="separator"
      tabIndex={0}
      aria-label="Resize panels"
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuemin={MIN_RATIO}
      aria-valuemax={MAX_RATIO}
      aria-valuenow={ratioBasisPoints}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        lastRatio.current = ratioBasisPoints;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={schedulePointerUpdate}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={() => {
        if (dragging.current) cancelDrag();
      }}
    />
  );
}
