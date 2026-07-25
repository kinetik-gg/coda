import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import dropdownStyles from '../components/DropdownMenu.module.css';
import type { PhosphorIcon } from './icon';
import styles from './content-lists.module.css';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: PhosphorIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

const ESTIMATED_ITEM_HEIGHT = 28;
const MENU_WIDTH = 200;

/**
 * A keyboard-operable, portal-rendered row context menu shared by every
 * content-list row. Focus lands on the first enabled item on open; arrow keys
 * rove, Escape/Tab/outside-click dismiss, and selection returns focus to the
 * originating row via `onClose`.
 */
export function RowContextMenu({
  items,
  anchor,
  align = 'start',
  ariaLabel,
  onClose,
}: {
  items: ContextMenuItem[];
  anchor: { x: number; y: number };
  align?: 'start' | 'end';
  ariaLabel: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    first?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const focusItemAt = (position: number) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) return;
    const clamped = (position + buttons.length) % buttons.length;
    buttons[clamped]?.focus();
  };

  const currentEnabledPosition = () => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    return buttons.indexOf(document.activeElement as HTMLButtonElement);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusItemAt(currentEnabledPosition() + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItemAt(currentEnabledPosition() - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItemAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusItemAt(enabledIndexes.length - 1);
        break;
      default:
        break;
    }
  };

  const height = items.length * ESTIMATED_ITEM_HEIGHT + 8;
  const left =
    align === 'end'
      ? Math.max(8, Math.min(anchor.x - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
      : Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(anchor.y, Math.max(8, window.innerHeight - height - 8));

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.menu}`}
      style={{ left, top }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={item.disabled}
            className={`${dropdownStyles.item} ${item.danger ? styles.menuDanger : ''}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {Icon && <Icon size={12} aria-hidden />}
            <span className={dropdownStyles.itemLabel}>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
