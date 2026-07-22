import { type ReactNode } from 'react';
import { type useInfiniteQuery } from '@tanstack/react-query';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/csr/EnvelopeSimple';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import styles from '../AdminScreen.module.css';
import type { AdminPage, ManagementListItem, Page } from './types';

export const pageDetails: Record<
  AdminPage,
  { label: string; title: string; description: string; icon: typeof GaugeIcon }
> = {
  overview: {
    label: 'Overview',
    title: 'Overview',
    description: 'Runtime health, resource pressure, and instance totals.',
    icon: GaugeIcon,
  },
  projects: {
    label: 'Projects',
    title: 'Projects',
    description: 'Active projects on this instance.',
    icon: BuildingsIcon,
  },
  users: {
    label: 'Users',
    title: 'Users',
    description: 'Registered accounts, access activity, and administrator password recovery.',
    icon: UsersIcon,
  },
  storage: {
    label: 'Storage',
    title: 'Storage',
    description: 'Uploaded source documents and assets, including retained objects.',
    icon: DatabaseIcon,
  },
  jobs: {
    label: 'Jobs',
    title: 'Jobs',
    description: 'Scheduled maintenance state and recent outcomes.',
    icon: PulseIcon,
  },
  audit: {
    label: 'Audit',
    title: 'Audit',
    description: 'Sanitized project activity across the instance.',
    icon: ClipboardTextIcon,
  },
  invitations: {
    label: 'Invitations',
    title: 'Invitations',
    description: 'Create email-bound magic links. Coda does not send outbound email.',
    icon: EnvelopeSimpleIcon,
  },
};

export function AdminSidebar({
  activePage,
  onPageChange,
}: {
  activePage: AdminPage;
  onPageChange: (page: AdminPage) => void;
}) {
  return (
    <aside className={styles.sidebar} aria-label="Instance management pages">
      <nav className={styles.sidebarNav}>
        {(Object.keys(pageDetails) as AdminPage[]).map((page) => {
          const item = pageDetails[page];
          const Icon = item.icon;
          return (
            <button
              key={page}
              type="button"
              className={styles.sidebarItem}
              aria-current={activePage === page ? 'page' : undefined}
              onClick={() => onPageChange(page)}
            >
              <Icon size={12} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className={styles.searchField}>
      <MagnifyingGlassIcon size={12} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        type="search"
      />
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.emptyState}>
      {icon}
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function LoadingRows() {
  return (
    <SkeletonGroup label="Loading records" className={styles.loadingRows}>
      {Array.from({ length: 5 }, (_, index) => (
        <div className={styles.loadingRow} key={index}>
          <Skeleton width={index % 2 ? '42%' : '55%'} height={10} />
          <Skeleton width="18%" height={9} />
          <Skeleton width="12%" height={9} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export type ManagementListQuery = ReturnType<
  typeof useInfiniteQuery<
    Page<ManagementListItem>,
    Error,
    { pages: Page<ManagementListItem>[]; pageParams: unknown[] },
    readonly unknown[],
    string
  >
>;

export function ListRegion({
  list,
  emptyTitle,
  emptyText,
  children,
  nested = false,
  automaticPagination = false,
}: {
  list: ManagementListQuery;
  emptyTitle: string;
  emptyText: string;
  children: ReactNode;
  nested?: boolean;
  automaticPagination?: boolean;
}) {
  if (list.isLoading) return <LoadingRows />;
  if (list.error) {
    return (
      <EmptyState icon={<WarningCircleIcon size={22} />} title="Records could not be loaded.">
        Check the API connection, then try again.
      </EmptyState>
    );
  }
  if (!list.data?.pages.some((page) => page.items.length)) {
    return (
      <EmptyState icon={<MagnifyingGlassIcon size={22} />} title={emptyTitle}>
        {emptyText}
      </EmptyState>
    );
  }
  return (
    <div className={nested ? undefined : styles.listRegion}>
      {children}
      {list.hasNextPage && !automaticPagination ? (
        <div className={styles.loadMore}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
