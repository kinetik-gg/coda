import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import styles from './DropdownMenu.module.css';

export interface DropdownMenuProps {
  id: string;
  label: ReactNode;
  ariaLabel?: string;
  open: boolean;
  className?: string;
  triggerClassName?: string;
  popupClassName?: string;
  align?: 'start' | 'end';
  rootRole?: 'none' | 'presentation';
  triggerRole?: 'menuitem' | undefined;
  portal?: boolean;
  triggerRef?: RefCallback<HTMLButtonElement>;
  popupRef?: RefCallback<HTMLDivElement>;
  onToggle: () => void;
  onTriggerKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onMenuKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function DropdownMenu({
  id,
  label,
  ariaLabel,
  open,
  className,
  triggerClassName,
  popupClassName,
  align = 'start',
  rootRole,
  triggerRole,
  portal = false,
  triggerRef,
  popupRef,
  onToggle,
  onTriggerKeyDown,
  onMenuKeyDown,
  children,
}: DropdownMenuProps) {
  const popupId = `dropdown-menu-${id}`;
  const internalTrigger = useRef<HTMLButtonElement | null>(null);
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !portal) {
      setPortalPosition(null);
      return;
    }
    const update = () => {
      const bounds = internalTrigger.current?.getBoundingClientRect();
      if (bounds)
        setPortalPosition({
          left: align === 'end' ? bounds.right : bounds.left,
          top: bounds.bottom + 3,
        });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [align, open, portal]);
  const popup =
    open && (!portal || portalPosition) ? (
      <div
        ref={popupRef}
        id={popupId}
        data-dropdown-menu={id}
        role="menu"
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        className={`${styles.popup} ${align === 'end' ? styles.popupEnd : ''} ${portal ? styles.portalled : ''} ${popupClassName ?? ''}`}
        style={
          portal && portalPosition
            ? { left: portalPosition.left, top: portalPosition.top }
            : undefined
        }
        onKeyDown={onMenuKeyDown}
      >
        {children}
      </div>
    ) : null;
  return (
    <div className={`${styles.root} ${className ?? ''}`} data-dropdown-menu={id} role={rootRole}>
      <button
        ref={(element) => {
          internalTrigger.current = element;
          triggerRef?.(element);
        }}
        type="button"
        className={`${styles.trigger} ${triggerClassName ?? ''}`}
        role={triggerRole}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={popupId}
        onClick={onToggle}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {portal && popup ? createPortal(popup, document.body) : popup}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  dismiss,
  shortcut,
  dismissOnSelect = true,
  ariaCurrent,
  checked,
}: {
  children: ReactNode;
  onSelect: () => void;
  dismiss?: () => void;
  shortcut?: string;
  dismissOnSelect?: boolean;
  ariaCurrent?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      tabIndex={-1}
      className={styles.item}
      aria-current={ariaCurrent || undefined}
      onClick={() => {
        if (dismissOnSelect) dismiss?.();
        onSelect();
      }}
    >
      {checked !== undefined && (
        <span className={styles.checkSlot} aria-hidden="true">
          {checked && <CheckIcon size={12} weight="bold" />}
        </span>
      )}
      <span className={styles.itemLabel}>{children}</span>
      {shortcut && <kbd aria-label={`Keyboard shortcut ${shortcut}`}>{shortcut}</kbd>}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <span role="separator" className={styles.separator} />;
}
