import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { Tooltip } from '../components/Tooltip';
import styles from './DenseWorkspace.module.css';

export interface PanelCommandItem {
  label: string;
  action: () => void;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  dismissOnSelect?: boolean;
}

export function PanelCommandMenu({
  label,
  triggerContent,
  triggerClassName,
  popupClassName,
  items,
}: {
  label: string;
  triggerContent?: ReactNode;
  triggerClassName?: string;
  popupClassName?: string;
  items: PanelCommandItem[];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: bounds.left, top: bounds.bottom + 4 });
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !(target instanceof Element && target.closest(`#${CSS.escape(id)}`))
      )
        setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', keyboard);
    };
  }, [id, open]);

  return (
    <>
      <Tooltip content={`Open ${label.toLowerCase()} commands for this panel`}>
        <button
          ref={trigger}
          type="button"
          className={triggerClassName}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            const bounds = trigger.current?.getBoundingClientRect();
            if (bounds) setPosition({ left: bounds.left, top: bounds.bottom + 4 });
            setOpen(true);
          }}
        >
          {triggerContent ?? label}
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div
            id={id}
            role="menu"
            aria-label={`${label} panel actions`}
            className={`${styles.panelCommandPopup} ${popupClassName ?? ''}`}
            style={position}
          >
            {items.map((item) => (
              <div
                key={item.label}
                className={item.separatorBefore ? styles.panelCommandSeparator : undefined}
              >
                <button
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked === undefined ? undefined : item.checked}
                  disabled={item.disabled}
                  onClick={() => {
                    item.action();
                    if (item.dismissOnSelect !== false) setOpen(false);
                  }}
                >
                  <span className={styles.panelCommandCheck}>
                    {item.checked && <CheckIcon size={12} />}
                  </span>
                  <span>{item.label}</span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
