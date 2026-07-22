import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './CustomSelect.module.css';

export interface CustomSelectOption {
  value: string;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
}

interface SharedSelectProps {
  options: CustomSelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  popupClassName?: string;
  onOpenChange?: (open: boolean) => void;
  autoFocus?: boolean;
}

export interface CustomSelectProps extends SharedSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export interface CustomMultiSelectProps extends SharedSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
}

function optionText(option: CustomSelectOption) {
  return option.textValue ?? (typeof option.label === 'string' ? option.label : option.value);
}

function nextEnabledIndex(options: CustomSelectOption[], current: number, direction: 1 | -1) {
  if (!options.length) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (current + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function useSelectShell({
  options,
  disabled,
  selectedIndex,
  onOpenChange,
}: {
  options: CustomSelectOption[];
  disabled?: boolean;
  selectedIndex: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef({ query: '', at: 0 });
  const [portalPosition, setPortalPosition] = useState<{
    left: number;
    top: number;
    minWidth: number;
  } | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (disabled && next) return;
      setOpenState(next);
      onOpenChange?.(next);
    },
    [disabled, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, setOpen]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open, setOpen]);

  useLayoutEffect(() => {
    if (!open) {
      setPortalPosition(null);
      return;
    }
    const position = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const popup = popupRef.current?.getBoundingClientRect();
      const popupWidth = popup?.width ?? bounds.width;
      const popupHeight = popup?.height ?? 0;
      const viewportGap = 12;
      const below = window.innerHeight - bounds.bottom - viewportGap;
      const above = bounds.top - viewportGap;
      const opensAbove = popupHeight > below && above > below;
      setPortalPosition({
        left: Math.max(
          viewportGap,
          Math.min(bounds.left, window.innerWidth - viewportGap - popupWidth),
        ),
        top: opensAbove ? Math.max(viewportGap, bounds.top - popupHeight - 4) : bounds.bottom + 4,
        minWidth: bounds.width,
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open && portalPosition && popupRef.current) {
      const bounds = popupRef.current.getBoundingClientRect();
      const triggerBounds = triggerRef.current?.getBoundingClientRect();
      if (!triggerBounds) return;
      const viewportGap = 12;
      const below = window.innerHeight - triggerBounds.bottom - viewportGap;
      const above = triggerBounds.top - viewportGap;
      const opensAbove = bounds.height > below && above > below;
      const left = Math.max(
        viewportGap,
        Math.min(triggerBounds.left, window.innerWidth - viewportGap - bounds.width),
      );
      const top = opensAbove
        ? Math.max(viewportGap, triggerBounds.top - bounds.height - 4)
        : triggerBounds.bottom + 4;
      if (left !== portalPosition.left || top !== portalPosition.top) {
        setPortalPosition((current) => (current ? { ...current, left, top } : current));
      }
    }
  }, [open, portalPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    const fallback = nextEnabledIndex(options, -1, 1);
    const next = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : fallback;
    setActiveIndex(next);
    requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }, [open, options, selectedIndex]);

  const move = (direction: 1 | -1) => {
    const next = nextEnabledIndex(options, activeIndex, direction);
    if (next < 0) return;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const closeAndFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const next = nextEnabledIndex(options, -1, 1);
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      const next = nextEnabledIndex(options, 0, -1);
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      setOpen(false);
      if (event.key === 'Escape') requestAnimationFrame(() => triggerRef.current?.focus());
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const previous = now - typeaheadRef.current.at < 650 ? typeaheadRef.current.query : '';
      const query = `${previous}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current = { query, at: now };
      const ordered = options.map((_, index) => (activeIndex + index + 1) % options.length);
      const next = ordered.find(
        (index) =>
          !options[index]?.disabled &&
          optionText(options[index]!).toLocaleLowerCase().startsWith(query),
      );
      if (next !== undefined) {
        event.preventDefault();
        setActiveIndex(next);
        optionRefs.current[next]?.focus();
      }
    }
  };

  return {
    open,
    activeIndex,
    rootRef,
    triggerRef,
    popupRef,
    portalPosition,
    optionRefs,
    setOpen,
    closeAndFocus,
    onTriggerKeyDown,
    onListKeyDown,
  };
}

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  placeholder = 'Select…',
  className,
  triggerClassName,
  popupClassName,
  onOpenChange,
  autoFocus,
}: CustomSelectProps) {
  const popupId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const shell = useSelectShell({ options, disabled, selectedIndex, onOpenChange });

  useEffect(() => {
    if (autoFocus) shell.triggerRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <div ref={shell.rootRef} className={`${styles.root} ${className ?? ''}`}>
      <button
        ref={shell.triggerRef}
        type="button"
        className={`${styles.trigger} ${triggerClassName ?? ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={shell.open}
        aria-controls={popupId}
        disabled={disabled}
        onClick={() => shell.setOpen(!shell.open)}
        onKeyDown={shell.onTriggerKeyDown}
      >
        <span className={selected ? undefined : styles.placeholder}>
          {selected?.label ?? placeholder}
        </span>
        <CaretUpDownIcon size={12} aria-hidden="true" />
      </button>
      {shell.open &&
        shell.portalPosition &&
        createPortal(
          <div
            ref={shell.popupRef}
            id={popupId}
            role="listbox"
            aria-label={ariaLabel}
            className={`${styles.popup} ${popupClassName ?? ''}`}
            style={shell.portalPosition}
            onKeyDown={shell.onListKeyDown}
          >
            {options.map((option, index) => (
              <button
                ref={(element) => {
                  shell.optionRefs.current[index] = element;
                }}
                key={option.value}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={styles.option}
                onClick={() => {
                  onChange(option.value);
                  shell.closeAndFocus();
                }}
              >
                <span className={styles.checkSlot}>
                  {option.value === value && (
                    <CheckIcon size={12} weight="bold" aria-hidden="true" />
                  )}
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function CustomMultiSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  placeholder = 'Select…',
  className,
  triggerClassName,
  popupClassName,
  onOpenChange,
  autoFocus,
}: CustomMultiSelectProps) {
  const popupId = useId();
  const selectedIndex = options.findIndex((option) => value.includes(option.value));
  const selectedLabels = options.filter((option) => value.includes(option.value)).map(optionText);
  const shell = useSelectShell({ options, disabled, selectedIndex, onOpenChange });

  useEffect(() => {
    if (autoFocus) shell.triggerRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <div ref={shell.rootRef} className={`${styles.root} ${className ?? ''}`}>
      <button
        ref={shell.triggerRef}
        type="button"
        className={`${styles.trigger} ${triggerClassName ?? ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={shell.open}
        aria-controls={popupId}
        disabled={disabled}
        onClick={() => shell.setOpen(!shell.open)}
        onKeyDown={shell.onTriggerKeyDown}
      >
        <span className={selectedLabels.length ? undefined : styles.placeholder}>
          {selectedLabels.length ? selectedLabels.join(', ') : placeholder}
        </span>
        <CaretUpDownIcon size={12} aria-hidden="true" />
      </button>
      {shell.open &&
        shell.portalPosition &&
        createPortal(
          <div
            ref={shell.popupRef}
            id={popupId}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable="true"
            className={`${styles.popup} ${popupClassName ?? ''}`}
            style={shell.portalPosition}
            onKeyDown={shell.onListKeyDown}
          >
            {options.map((option, index) => {
              const checked = value.includes(option.value);
              return (
                <button
                  ref={(element) => {
                    shell.optionRefs.current[index] = element;
                  }}
                  key={option.value}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={checked}
                  disabled={option.disabled}
                  className={styles.option}
                  onClick={() =>
                    onChange(
                      checked
                        ? value.filter((entry) => entry !== option.value)
                        : [...value, option.value],
                    )
                  }
                >
                  <span className={styles.checkSlot}>
                    {checked && <CheckIcon size={12} weight="bold" aria-hidden="true" />}
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
