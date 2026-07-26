import type { ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import styles from './PanelHeader.module.css';

interface SearchField {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

interface TitleHeaderProps {
  /** A flat uppercase 10px title (content-list pages: Screenplays, Breakdowns, Trash). */
  title: string;
  crumbs?: undefined;
  /** A tabular count rendered in `--coda-disabled` beside the title. */
  count?: number;
  /** A right-end dense search field, rendered ahead of `actions`. */
  search?: SearchField;
  actions?: ReactNode;
}

interface CrumbsHeaderProps {
  title?: undefined;
  /** A breadcrumb trail; the last entry is the page heading (`h1`). */
  crumbs: readonly string[];
  count?: undefined;
  search?: undefined;
  actions?: ReactNode;
}

export type PanelHeaderProps = TitleHeaderProps | CrumbsHeaderProps;

/**
 * The 30px panel-frame header shared by every dashboard surface. Two
 * variants share one frame, border, and trailing-controls slot:
 *
 * - `title` (+ optional `count` / `search`) — the content-list variant: an
 *   uppercase 10px title, a tabular count in `--coda-disabled`, and a
 *   right-end dense search field ahead of `actions`.
 * - `crumbs` — the account/admin/instance-settings variant: a breadcrumb
 *   trail resolved from the rail declarations (see `nav-model.ts`) so
 *   navigation and headers never drift; the final crumb is the page
 *   heading, exposed as an `h1` for assistive tech.
 *
 * Both variants host dense 22px actions in the trailing slot.
 */
export function PanelHeader(props: PanelHeaderProps) {
  if (props.crumbs !== undefined) {
    const { crumbs, actions } = props;
    const heading = crumbs[crumbs.length - 1] ?? '';
    const prefix = crumbs.slice(0, -1);
    return (
      <header className={`${styles.header} ${styles.headerCrumbs}`}>
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

  const { title, count, search, actions } = props;
  return (
    <header className={`${styles.header} ${styles.headerTitle}`}>
      <h1 className={styles.panelTitle}>{title}</h1>
      {count !== undefined && (
        <span className={styles.panelCount} aria-hidden="true">
          {count}
        </span>
      )}
      <div className={styles.panelControls}>
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
