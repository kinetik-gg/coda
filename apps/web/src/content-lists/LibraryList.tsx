import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import styles from './LibraryList.module.css';

/** One object in a library, whatever kind of object the library holds. */
export interface LibraryItem {
  id: string;
  name: string;
  /** A quiet qualifier: `SHARED WITH YOU` in a library, the kind in Trash. */
  tag?: string;
  /** Trailing metadata — a paper size, a relative time, a retention notice. */
  meta?: ReactNode;
  menu: ContextMenuItem[];
}

/**
 * The page frame every library shares: a centred column holding a title, a line of orientation,
 * the surface's actions, and the list itself.
 *
 * Screenplays, Breakdowns and Trash are three views of one idea — a list of objects you own or
 * can reach — and they had drifted into three layouts with three sets of columns (#193). They
 * are one component now, so a change to how a library reads happens once.
 */
export function LibraryPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/** The dashed placeholder a library shows before it holds anything. */
export function LibraryEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {hint ? <p className={styles.emptyHint}>{hint}</p> : null}
    </div>
  );
}

function LibraryRow({
  item,
  onActivate,
}: {
  item: LibraryItem;
  onActivate?: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number }>();

  const openMenu = (x: number, y: number) => {
    if (item.menu.length > 0) setAnchor({ x, y });
  };

  return (
    <div
      role="row"
      tabIndex={0}
      aria-label={item.name}
      className={styles.row}
      onDoubleClick={() => onActivate?.(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onActivate?.(item.id);
      }}
      onContextMenu={(event: ReactMouseEvent) => {
        if (item.menu.length === 0) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      <span className={styles.name}>{item.name}</span>
      {item.tag ? <span className={styles.tag}>{item.tag}</span> : null}
      <span className={styles.meta}>{item.meta}</span>
      {item.menu.length > 0 && (
        <button
          type="button"
          className={styles.menuButton}
          aria-label={`Actions for ${item.name}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenu(box.right, box.bottom);
          }}
        >
          <DotsThreeIcon size={18} weight="bold" aria-hidden />
        </button>
      )}
      {anchor && (
        <RowContextMenu
          items={item.menu}
          anchor={anchor}
          align="end"
          ariaLabel={`Actions for ${item.name}`}
          onClose={() => setAnchor(undefined)}
        />
      )}
    </div>
  );
}

/** The list itself: one surface, one row treatment, whatever the objects are. */
export function LibraryList({
  items,
  ariaLabel,
  onActivate,
}: {
  items: readonly LibraryItem[];
  ariaLabel: string;
  onActivate?: (id: string) => void;
}) {
  return (
    <div role="table" aria-label={ariaLabel} className={styles.list}>
      {items.map((item) => (
        <LibraryRow key={item.id} item={item} onActivate={onActivate} />
      ))}
    </div>
  );
}
