import type { ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import type { PhosphorIcon } from './icon';
import { absoluteTime, relativeTime } from './relative-time';
import styles from './content-lists.module.css';

/** The flex-column page frame that hosts a panel header above a scroll body. */
export function ContentListPage({
  busy,
  ariaLabel,
  children,
}: {
  busy?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.page} aria-busy={busy} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

/** The scrolling body region beneath the panel header. */
export function ScrollBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

/**
 * The content-plane header for object libraries. The path carries the one page heading while
 * search and creation remain dense trailing tools; counts qualify the heading instead of becoming
 * a second label over the rows.
 */
export function LibraryHeader({
  crumbs,
  count,
  search,
  actions,
}: {
  crumbs: readonly string[];
  count?: number;
  search?: { value: string; onChange: (value: string) => void; label: string };
  actions?: ReactNode;
}) {
  const heading = crumbs.at(-1) ?? '';
  return (
    <header className={styles.libraryHeader}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        {crumbs.slice(0, -1).map((crumb) => (
          <span key={crumb} className={styles.breadcrumbPrefix}>
            <span>{crumb}</span>
            <CaretRightIcon size={12} aria-hidden />
          </span>
        ))}
        <h1>{heading}</h1>
        {count !== undefined && (
          <span className={styles.headingCount} aria-hidden="true">
            {count}
          </span>
        )}
      </nav>
      <div className={styles.libraryTools}>
        {search && (
          <label className={styles.search}>
            <MagnifyingGlassIcon size={12} aria-hidden />
            <input
              type="search"
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder="Search"
              aria-label={search.label}
            />
          </label>
        )}
        {actions}
      </div>
    </header>
  );
}

/** A dense 22px header action button (primary uses the selection fill). */
export function HeaderButton({
  primary,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={primary ? styles.actionPrimary : styles.action}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A sentence-case content heading with a quiet tabular count, above a grouped object list. */
export function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <h2 className={styles.sectionLabel}>
      {label}
      <span aria-hidden="true">{count}</span>
    </h2>
  );
}

/** A muted trailing row status (e.g. "Restoring…", "Owner only"). */
export function RowStatus({ children }: { children: ReactNode }) {
  return <span className={styles.rowStatus}>{children}</span>;
}

/** An inline error banner rendered beneath a table. */
export function InlineError({ message }: { message: string }) {
  return (
    <p className={styles.inlineError} role="alert">
      {message}
    </p>
  );
}

/** A centered 12px leading row glyph in `--coda-icon`. */
export function CellIcon({ icon: Icon }: { icon: PhosphorIcon }) {
  return (
    <span className={styles.iconCell}>
      <Icon size={12} aria-hidden />
    </span>
  );
}

/** A wrapping object name followed by optional prose or filename metadata. */
export function PrimaryText({ name, subtitle }: { name: string; subtitle?: string | null }) {
  return (
    <span className={styles.primaryCell}>
      <strong>{name}</strong>
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  );
}

/** A relative timestamp cell with the absolute value disclosed on hover. */
export function TimeCell({ iso }: { iso: string }) {
  return (
    <time className={styles.time} dateTime={iso} title={absoluteTime(iso)}>
      {relativeTime(iso)}
    </time>
  );
}

/** An 18px bordered uppercase chip (role/kind badge). */
export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={styles.chip} title={title}>
      {children}
    </span>
  );
}

/** A compact state at the top-left of the content plane, in the editor's voice. */
export function StateBlock({
  message,
  action,
  alert = false,
}: {
  message: string;
  action?: { label: string; onClick: () => void; primary?: boolean; busy?: boolean };
  alert?: boolean;
}) {
  return (
    <div className={styles.stateBlock} role={alert ? 'alert' : undefined}>
      <p>{message}</p>
      {action && (
        <button
          type="button"
          className={styles.action}
          disabled={action.busy}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
