import { type ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import styles from './DashboardSectionHeader.module.css';

/**
 * The 30px panel-frame header for dashboard section bodies (account / admin /
 * instance settings). The breadcrumb trail is resolved from the rail
 * declarations (see `nav-model.ts`) so navigation and headers never drift; the
 * final crumb is the page heading, exposed as an `h1` for assistive tech.
 * Optional trailing `actions` host dense controls such as a search field.
 */
export function DashboardSectionHeader({
  crumbs,
  actions,
}: {
  crumbs: readonly string[];
  actions?: ReactNode;
}) {
  const heading = crumbs[crumbs.length - 1] ?? '';
  const prefix = crumbs.slice(0, -1);
  return (
    <header className={styles.header}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        {prefix.map((crumb) => (
          <span key={crumb} className={styles.crumb}>
            <span className={styles.crumbText}>{crumb}</span>
            <CaretRightIcon size={12} aria-hidden className={styles.crumbSep} />
          </span>
        ))}
        <h1 className={styles.heading}>{heading}</h1>
      </nav>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
