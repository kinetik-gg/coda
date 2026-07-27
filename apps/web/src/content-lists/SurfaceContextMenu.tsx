import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import styles from './content-lists.module.css';

/**
 * Right-click anywhere on the content plane that is not a row.
 *
 * The empty area of a library is the largest target on the surface and it did nothing (#193).
 * What belongs here is what the *surface* can do — create, import — as opposed to what a row can
 * do, which the row menu already answers.
 *
 * The items are built from the same `ContextMenuItem` shape and rendered by the same
 * `RowContextMenu`, so the plane cannot grow a second menu vocabulary or a second set of
 * enablement rules. A right-click that lands on a row is left alone: that event is the row's,
 * and the row menu is more specific.
 */
export function SurfaceContextMenu({
  items,
  ariaLabel,
  children,
}: {
  items: readonly ContextMenuItem[];
  ariaLabel: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number }>();

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A row handled it already, or the click landed on something interactive that owns its own
    // menu semantics (an input, a trigger button). Leave those alone.
    if ((event.target as HTMLElement).closest('[role="row"], input, textarea, button, a')) return;
    if (items.length === 0) return;
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className={styles.surfaceMenuHost} onContextMenu={onContextMenu}>
      {children}
      {anchor && (
        <RowContextMenu
          items={[...items]}
          anchor={anchor}
          ariaLabel={ariaLabel}
          onClose={() => setAnchor(undefined)}
        />
      )}
    </div>
  );
}
