import type { ReactNode } from 'react';
import { CaretDoubleLeftIcon } from '@phosphor-icons/react/dist/csr/CaretDoubleLeft';
import { CaretDoubleRightIcon } from '@phosphor-icons/react/dist/csr/CaretDoubleRight';
import { PanelHeader } from '../app-shell/PanelHeader';
import dropdownStyles from '../components/DropdownMenu.module.css';
import listStyles from './content-lists.module.css';
import type { ContextMenuItem } from './RowContextMenu';
import styles from './Properties.module.css';

/**
 * The properties pane chrome: the unified panel-frame header (#152) over an
 * internally scrolling body, plus the collapsed rail stripe.
 *
 * Collapsed, the pane becomes a `--coda-h-menu` rail with a vertical label and a
 * restore control — the tool-window stripe idiom — so the surface never loses the
 * affordance that brings the pane back.
 */
export function PropertiesPane({
  title = 'Properties',
  width,
  collapsed,
  busy,
  onToggleCollapsed,
  children,
}: {
  title?: string;
  width: number;
  collapsed: boolean;
  /** Reported as `aria-busy` while the pane is still resolving its subject. */
  busy?: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <div className={styles.rail}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={false}
          aria-label={`Show ${title.toLowerCase()}`}
          onClick={onToggleCollapsed}
        >
          <CaretDoubleLeftIcon size={12} aria-hidden />
        </button>
        <span className={styles.railLabel} aria-hidden="true">
          {title}
        </span>
      </div>
    );
  }

  return (
    <aside
      className={styles.pane}
      aria-label={title}
      aria-busy={busy}
      style={{ ['--properties-width' as string]: `${width}px` }}
    >
      <PanelHeader
        title={title}
        actions={
          <button
            type="button"
            className={styles.toggle}
            aria-expanded
            aria-label={`Hide ${title.toLowerCase()}`}
            onClick={onToggleCollapsed}
          >
            <CaretDoubleRightIcon size={12} aria-hidden />
          </button>
        }
      />
      <div className={styles.paneBody}>{children}</div>
    </aside>
  );
}

/** The selected row's identity block: its name over a monospaced secondary line. */
export function PropertiesIdentity({ name, meta }: { name: string; meta?: string | null }) {
  return (
    <div className={styles.identity}>
      <h2 className={styles.identityTitle} title={name}>
        {name}
      </h2>
      {meta ? (
        <span className={styles.identityMeta} title={meta}>
          {meta}
        </span>
      ) : null}
    </div>
  );
}

/** An uppercase section divider inside the pane, with an optional tabular count. */
export function PropertiesSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={label}>
      <h3 className={styles.sectionHead}>
        {label}
        {count !== undefined && (
          <span className={styles.sectionCount} aria-hidden="true">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** The metadata description list that hosts {@link PropertiesField} rows. */
export function PropertiesFields({ children }: { children: ReactNode }) {
  return <dl className={styles.fields}>{children}</dl>;
}

/**
 * A dense label/value metadata row. Rendered as a `dt`/`dd` pair so assistive
 * technology reads the pair as one term and its value; `numeric` renders the
 * value in tabular figures.
 */
export function PropertiesField({
  label,
  numeric,
  children,
}: {
  label: string;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={`${styles.fieldValue} ${numeric ? styles.numeric : ''}`}>{children}</dd>
    </div>
  );
}

/** A dense list row: an optional leading glyph, a primary line, a trailing value. */
export function PropertiesListRow({
  leading,
  primary,
  secondary,
}: {
  leading?: ReactNode;
  primary: string;
  secondary?: ReactNode;
}) {
  return (
    <div className={styles.listRow}>
      {leading ? <span className={styles.marker}>{leading}</span> : null}
      <span className={styles.listPrimary} title={primary}>
        {primary}
      </span>
      {secondary ? <span className={styles.listSecondary}>{secondary}</span> : null}
    </div>
  );
}

/**
 * The pane's quick actions.
 *
 * Deliberately driven by the same {@link ContextMenuItem} array the row context
 * menu is built from, and rendered with the same item chrome, so the properties
 * cannot answer a question differently from the row menu: one vocabulary, one
 * set of handlers, one enablement rule. Callers pass `buildMenu(row)` verbatim.
 */
export function PropertiesQuickActions({
  items,
  ariaLabel = 'Quick actions',
}: {
  items: readonly ContextMenuItem[];
  ariaLabel?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.actions} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            className={`${dropdownStyles.item} ${item.danger ? listStyles.menuDanger : ''}`}
            onClick={item.onSelect}
          >
            {Icon && <Icon size={12} aria-hidden />}
            <span className={dropdownStyles.itemLabel}>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** The vertically centred pane state: one sentence, no illustration. */
export function PropertiesEmpty({ message }: { message: string }) {
  return (
    <div className={styles.paneEmpty}>
      <p>{message}</p>
    </div>
  );
}

/**
 * A muted inline note beneath a section — a permission caveat, an availability
 * note, or a load failure with its retry.
 */
export function PropertiesNote({
  children,
  action,
  alert = false,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  alert?: boolean;
}) {
  return (
    <p className={styles.paneNote} role={alert ? 'alert' : undefined}>
      {children}
      {action && (
        <button type="button" className={listStyles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </p>
  );
}
