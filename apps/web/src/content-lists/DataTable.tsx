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
  /** Uppercase column label; an empty string renders a visually-hidden header. */
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
 * A dense, grid-based data table in the editor idiom: a sticky 10px-uppercase
 * header row, 28px body rows, roving row focus (arrow keys / Home / End),
 * Enter or double-click to activate, and a per-row context menu reachable by
 * right-click, the overflow affordance, or the keyboard (Shift+F10 / the
 * context-menu key).
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
  buildMenu?: (row: T) => ContextMenuItem[];
  /** Optional non-menu trailing cell (e.g. a busy indicator). */
  trailingCell?: (row: T) => ReactNode;
}) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rowHasMenu = (row: T) => Boolean(buildMenu) && (buildMenu?.(row).length ?? 0) > 0;
  const hasTrailing = Boolean(buildMenu) || Boolean(trailingCell);

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    setFocusedIndex(clamped);
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
    setFocusedIndex(index);
    openMenuForRow(index, event.clientX, event.clientY, 'start');
  };

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rows.length}
      className={styles.table}
      style={{ ['--content-grid' as string]: gridTemplate }}
    >
      <div role="row" className={styles.headRow}>
        {columns.map((column) => (
          <span
            key={column.key}
            role="columnheader"
            className={`${styles.columnHeader} ${column.numeric ? styles.numeric : ''}`}
          >
            {column.header}
          </span>
        ))}
        {hasTrailing && <span role="columnheader" aria-label="Actions" />}
      </div>
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
            onClick={() => setFocusedIndex(index)}
            onFocus={() => setFocusedIndex(index)}
            onDoubleClick={() => onActivate?.(row)}
            onKeyDown={(event) => onRowKeyDown(event, index)}
            onContextMenu={(event) => onRowContextMenu(event, index)}
          >
            {columns.map((column) => (
              <span
                key={column.key}
                role="gridcell"
                className={`${styles.cell} ${column.numeric ? styles.numeric : ''} ${column.cellClassName ?? ''}`}
              >
                {column.render(row)}
              </span>
            ))}
            {hasTrailing && (
              <span role="gridcell" className={styles.overflowCell}>
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
                      setFocusedIndex(index);
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
