import { useState } from 'react';
import { AdminSidebar, pageDetails, SearchField } from './admin/AdminCommon';
import { AdminDialogs, AdminPageBody } from './admin/AdminScreenViews';
import type { AdminPage } from './admin/types';
import { useAdminController } from './admin/useAdminController';
import { adminPagePath } from './app-routing';
import { resolveRailCrumbs } from './app-shell/nav-model';
import { DashboardSectionHeader } from './app-shell/DashboardSectionHeader';
import styles from './AdminScreen.styles';

export type { AdminPage, InstanceManagementSummary } from './admin/types';

export function AdminScreen({
  page,
  embedded = false,
  onPageChange,
}: {
  page?: AdminPage;
  embedded?: boolean;
  onPageChange?: (page: AdminPage) => void;
} = {}) {
  const [localPage, setLocalPage] = useState<AdminPage>('overview');
  const activePage = page ?? localPage;
  const controller = useAdminController(activePage);
  const detail = pageDetails[activePage];
  const changePage = (nextPage: AdminPage) => {
    setLocalPage(nextPage);
    onPageChange?.(nextPage);
    controller.setSearch('');
    controller.setUserStatusFeedback(null);
  };

  return (
    <main className={styles.page} aria-busy={controller.management.isLoading}>
      <DashboardSectionHeader
        crumbs={resolveRailCrumbs(adminPagePath(activePage))}
        actions={
          controller.listEnabled ? (
            <SearchField
              value={controller.search}
              onChange={controller.setSearch}
              label={`Search ${detail.label.toLowerCase()}`}
            />
          ) : undefined
        }
      />
      <div className={styles.body}>
        {!embedded && <AdminSidebar activePage={activePage} onPageChange={changePage} />}
        <div className={styles.bodyContent}>
          <AdminPageBody
            activePage={activePage}
            controller={controller}
            onPageChange={changePage}
          />
        </div>
      </div>
      <AdminDialogs controller={controller} />
    </main>
  );
}
