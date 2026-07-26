import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { getKeybindingLabel } from '../keybindings';
import appStyles from '../App.styles';
import type { DashboardCommandContext, PaletteMode } from './dashboard-commands';
import {
  buildPaletteRows,
  filterPaletteRows,
  firstEnabledIndex,
  groupPaletteRows,
  nextEnabledIndex,
  palettePrompt,
  type PaletteRow,
} from './command-palette-model';
import styles from './CommandPalette.module.css';

/**
 * The discoverable half of the ⌘K affordance: a masthead control for people who never learn the
 * chord. It sits in the trailing cluster, clear of the frameless-window traffic-light region.
 */
export function CommandPaletteTrigger({ onOpen }: { onOpen: () => void }) {
  const chord = getKeybindingLabel('commandPalette');
  return (
    <button
      type="button"
      className={styles.paletteTrigger}
      aria-label="Open the command palette"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={onOpen}
    >
      <MagnifyingGlassIcon size={11} aria-hidden />
      <span>Commands</span>
      {chord && <span className={styles.paletteTriggerChord}>{chord}</span>}
    </button>
  );
}

function Option({
  row,
  id,
  active,
  onActivate,
  onHover,
}: {
  row: PaletteRow;
  id: string;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
}) {
  const reference = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) reference.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const className = [
    styles.option,
    active ? styles.optionActive : '',
    row.disabled ? styles.optionDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={reference}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={row.disabled ?? false}
      aria-current={row.current ? 'true' : undefined}
      className={className}
      onPointerMove={onHover}
      // Pointer-down rather than click keeps the combobox input focused, so the palette never
      // loses its `aria-activedescendant` relationship mid-interaction.
      onPointerDown={(event) => {
        event.preventDefault();
        if (!row.disabled) onActivate();
      }}
    >
      <span className={styles.optionText}>
        <span className={styles.optionLabel}>{row.label}</span>
        {row.detail && <span className={styles.optionDetail}>{row.detail}</span>}
      </span>
      {row.shortcut && <span className={styles.optionShortcut}>{row.shortcut}</span>}
    </div>
  );
}

/**
 * ⌘K command palette — a complement to the menu bar, not a replacement for it. Every visible
 * command in {@link ./dashboard-commands} appears here, alongside the mounted surface's objects,
 * so the fast path and the discoverable path stay the same path.
 *
 * The dialog is an ARIA combobox over a listbox: the input keeps focus and owns the keyboard,
 * options are announced through `aria-activedescendant`, and the result count is reported to a
 * polite live region as the query narrows.
 */
export function CommandPalette({
  mode,
  context,
  onClose,
}: {
  mode: PaletteMode;
  context: DashboardCommandContext;
  onClose: () => void;
}) {
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Captured during the first render: the input autofocuses in the commit phase, so an effect
  // would already be looking at the palette itself rather than at whatever opened it.
  const restoreFocusTo = useRef<Element | null>(document.activeElement);

  useEffect(
    () => () => {
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
    },
    [],
  );

  const prompt = palettePrompt(mode, context.library);
  const groups = groupPaletteRows(filterPaletteRows(buildPaletteRows(mode, context), query));
  // Grouping is the rendered order, so keyboard traversal walks the grouped flattening rather than
  // the pre-grouped list — otherwise the highlight and the arrow keys would disagree.
  const rows = groups.flatMap((group) => group.rows);
  // Clamp during render rather than in an effect: the row list derives from a context whose
  // identity changes on every shell render, so an effect would either loop or lag a keystroke.
  const active =
    rows[activeIndex] && !rows[activeIndex].disabled ? activeIndex : firstEnabledIndex(rows);
  const activeRow = rows[active];

  const runRow = (row: PaletteRow | undefined) => {
    if (!row || row.disabled) return;
    onClose();
    row.run();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(rows, active, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(rows, active, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(firstEnabledIndex(rows));
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(rows, rows.length, -1));
        break;
      case 'Enter':
        event.preventDefault();
        runRow(activeRow);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      case 'Tab':
        // A single-input dialog: keep the caret where the keyboard model expects it.
        event.preventDefault();
        break;
      default:
        break;
    }
  };

  let flatIndex = -1;
  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        onKeyDown={onKeyDown}
      >
        <div className={styles.prompt}>
          <MagnifyingGlassIcon size={13} aria-hidden />
          {mode !== 'all' && <span className={styles.mode}>{prompt.title}</span>}
          <input
            autoFocus
            className={styles.input}
            type="text"
            role="combobox"
            aria-label={prompt.title}
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeRow ? optionId(active) : undefined}
            placeholder={prompt.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label={`${prompt.title} results`}
          className={styles.results}
        >
          {rows.length === 0 ? (
            <p className={styles.empty}>No matching commands.</p>
          ) : (
            groups.map((group) => (
              <div key={group.section} role="group" aria-label={group.section}>
                <p className={styles.groupLabel}>{group.section}</p>
                {group.rows.map((row) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <Option
                      key={row.id}
                      row={row}
                      id={optionId(index)}
                      active={index === active}
                      onActivate={() => runRow(row)}
                      onHover={() => !row.disabled && setActiveIndex(index)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className={styles.footer}>
          <span>↑↓ Navigate</span>
          <span>⏎ Run</span>
          <span>Esc Close</span>
        </div>
        <p aria-live="polite" className={appStyles.visuallyHidden}>
          {rows.length} {rows.length === 1 ? 'result' : 'results'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
