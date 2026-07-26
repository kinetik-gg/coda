import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { DotsThreeVerticalIcon } from '@phosphor-icons/react/dist/csr/DotsThreeVertical';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import styles from './content-lists.module.css';

export interface DataColumn<T> {
  key: string;
  /** Accessible cell label. Object lists do not render a spreadsheet-style header strip. */
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  cellClassName?: string;
}

interface MenuState {
  index: number;
  x: number;
  y: number;
  align: 'start' | 'end';
}

/**
 * A dense, headerless object list with a grid only for row composition: roving
 * row focus (arrow keys / Home / End), Enter or double-click to activate, and
 * a per-row context menu reachable by right-click, the overflow affordance, or
 * the keyboard (Shift+F10 / the context-menu key).
 *
 * When `onSelect` is supplied the table also reports the current row, so a
 * trailing inspector pane follows the same focus the keyboard already moves —
 * click, arrow keys, Home/End and the overflow affordance all select. Activation
 * (`onActivate`) stays a separate, louder gesture.
 */
export function DataTable<T>({
  ariaLabel,
  columns,
  gridTemplate,
  rows,
  rowKey,
  rowLabel,
  isSelected,
  onActivate,
  onSelect,
  buildMenu,
  trailingCell,
}: {
  ariaLabel: string;
  columns: DataColumn<T>[];
  gridTemplate: string;
  rows: T[];
  rowKey: (row: T) => string;
  rowLabel: (row: T) => string;
  isSelected?: (row: T) => boolean;
  onActivate?: (row: T) => void;
  /** Reports the row the user moved to, for a detail surface such as the inspector. */
  onSelect?: (row: T) => void;
  buildMenu?: (row: T) => ContextMenuItem[];
  /** Optional non-menu trailing cell (e.g. a busy indicator). */
  trailingCell?: (row: T) => ReactNode;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reportedKeyRef = useRef<string | undefined>(undefined);
  const rowHasMenu = (row: T) => Boolean(buildMenu) && (buildMenu?.(row).length ?? 0) > 0;
  const hasTrailing = Boolean(buildMenu) || Boolean(trailingCell);

  // Focusing a row fires both the programmatic mark and the DOM focus handler;
  // the last reported key keeps `onSelect` to one call per actual move.
  const markRow = (index: number) => {
    setFocusedIndex(index);
    const row = rows[index];
    if (row === undefined) return;
    const key = rowKey(row);
    if (reportedKeyRef.current === key) return;
    reportedKeyRef.current = key;
    onSelect?.(row);
  };

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    markRow(clamped);
    rowRefs.current[clamped]?.focus();
  };

  const openMenuForRow = (index: number, x: number, y: number, align: 'start' | 'end') => {
    if (!rowHasMenu(rows[index]!)) return;
    setMenu({ index, x, y, align });
  };

  const openMenuFromKeyboard = (index: number) => {
    const bounds = rowRefs.current[index]?.getBoundingClientRect();
    if (bounds) openMenuForRow(index, bounds.left + 12, bounds.bottom, 'start');
  };

  const closeMenu = () => {
    const restoreIndex = menu?.index ?? focusedIndex;
    setMenu(null);
    rowRefs.current[restoreIndex]?.focus();
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (onActivate) {
          event.preventDefault();
          onActivate(rows[index]!);
        }
        break;
      case 'ContextMenu':
        event.preventDefault();
        openMenuFromKeyboard(index);
        break;
      case 'F10':
        if (event.shiftKey) {
          event.preventDefault();
          openMenuFromKeyboard(index);
        }
        break;
      default:
        break;
    }
  };

  const onRowContextMenu = (event: ReactMouseEvent<HTMLDivElement>, index: number) => {
    if (!rowHasMenu(rows[index]!)) return;
    event.preventDefault();
    markRow(index);
    openMenuForRow(index, event.clientX, event.clientY, 'start');
  };

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rows.length}
      aria-colcount={columns.length + (hasTrailing ? 1 : 0)}
      className={styles.table}
      style={{ ['--content-grid' as string]: gridTemplate }}
    >
      {rows.map((row, index) => {
        const key = rowKey(row);
        const selected = isSelected?.(row) ?? false;
        return (
          <div
            key={key}
            role="row"
            aria-rowindex={index + 1}
            aria-label={rowLabel(row)}
            aria-selected={selected}
            tabIndex={index === focusedIndex ? 0 : -1}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            className={styles.row}
            onClick={() => markRow(index)}
            onFocus={() => markRow(index)}
            onDoubleClick={() => onActivate?.(row)}
            onKeyDown={(event) => onRowKeyDown(event, index)}
            onContextMenu={(event) => onRowContextMenu(event, index)}
          >
            {columns.map((column) => (
              <span
                key={column.key}
                role="gridcell"
                aria-label={column.header || undefined}
                className={`${styles.cell} ${column.numeric ? styles.numeric : ''} ${column.cellClassName ?? ''}`}
              >
                {column.render(row)}
              </span>
            ))}
            {hasTrailing && (
              <span role="gridcell" aria-label="Actions" className={styles.overflowCell}>
                {trailingCell?.(row)}
                {rowHasMenu(row) && (
                  <button
                    type="button"
                    className={styles.overflowButton}
                    aria-haspopup="menu"
                    aria-label={`Actions for ${rowLabel(row)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      markRow(index);
                      openMenuForRow(index, bounds.right, bounds.bottom, 'end');
                    }}
                  >
                    <DotsThreeVerticalIcon size={12} weight="bold" aria-hidden />
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}
      {menu && buildMenu && rows[menu.index] && (
        <RowContextMenu
          items={buildMenu(rows[menu.index]!)}
          anchor={{ x: menu.x, y: menu.y }}
          align={menu.align}
          ariaLabel={`Actions for ${rowLabel(rows[menu.index]!)}`}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
