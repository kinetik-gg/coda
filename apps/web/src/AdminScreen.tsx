import { useState } from 'react';
import { AdminSidebar, pageDetails, SearchField } from './admin/AdminCommon';
import { AdminDialogs, AdminPageBody } from './admin/AdminScreenViews';
import type { AdminPage } from './admin/types';
import { useAdminController } from './admin/useAdminController';
import styles from './AdminScreen.module.css';

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
    <main
      className={`${styles.adminPage} ${embedded ? styles.embedded : ''}`}
      aria-busy={controller.management.isLoading}
    >
      <div className={styles.adminShell}>
        {!embedded && <AdminSidebar activePage={activePage} onPageChange={changePage} />}
        <div className={styles.content}>
          <header className={styles.contentHeader}>
            <div className={styles.headingLine}>
              <div>
                <h1>{detail.title}</h1>
                <p>{detail.description}</p>
              </div>
              {controller.listEnabled && (
                <SearchField
                  value={controller.search}
                  onChange={controller.setSearch}
                  label={`Search ${detail.label.toLowerCase()}`}
                />
              )}
            </div>
          </header>
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
