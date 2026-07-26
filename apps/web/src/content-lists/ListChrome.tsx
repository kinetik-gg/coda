import type { ReactNode } from 'react';
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

/** An uppercase section divider with a tabular count, above a grouped table. */
export function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className={styles.sectionLabel}>
      {label}
      <span>{count}</span>
    </div>
  );
}

/** A single-line inline placeholder for an empty section within a populated page. */
export function InlineEmpty({ message }: { message: string }) {
  return <p className={styles.tableEmpty}>{message}</p>;
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

/** A primary name cell with an optional muted secondary line (filename etc.). */
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

/**
 * A vertically centered state block: a single 12px sentence and, optionally,
 * one action button. Used for empty, loading, and error states — no
 * illustrations, in the editors' voice.
 */
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
          className={action.primary ? styles.actionPrimary : styles.action}
          disabled={action.busy}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
