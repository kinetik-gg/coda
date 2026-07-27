import { useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import styles from './ScreenplayEditorScreen.module.css';

/**
 * A panel-header filter that stays out of the way until it is asked for.
 *
 * The field used to occupy header width permanently on every panel that could filter, which is
 * a lot of chrome spent on a control most sessions never touch (#193). This mirrors the pattern
 * the breakdown workspace's entity table already uses: a button until you click it, a field
 * after — and it stays open while it holds a query, so a filtered panel never hides why.
 */
export function PanelFilterField({
  label,
  placeholder = 'Filter',
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.panelHeaderIconButton}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlassIcon size={12} aria-hidden="true" />
      </button>
    );
  }

  return (
    <label className={styles.panelHeaderSearch}>
      <span className={styles.visuallyHidden}>{label}</span>
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          // A filter that is doing something stays visible; an empty one gets out of the way.
          if (!value) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onChange('');
          setOpen(false);
        }}
      />
    </label>
  );
}
