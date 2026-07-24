import { useCallback, useState } from 'react';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { AccountScreen } from '../AccountScreen';
import type { AccountPage } from '../account-validation';
import { AdminScreen } from '../AdminScreen';
import type { AdminPage } from '../admin/types';
import { InstanceSettingsScreen } from '../instance-settings/InstanceSettingsScreen';
import type { InstanceSettingsSection } from '../instance-settings/types';
import { ProjectsScreen } from '../ProjectsScreen';
import { ScreenplaysScreen } from '../ScreenplaysScreen';
import {
  accountPageFromRoute,
  adminPageFromRoute,
  instanceSettingsSectionFromRoute,
  instanceSettingsSectionPath,
  isAccountRoute,
  isAdminRoute,
  isInstanceSettingsRoute,
} from '../app-routing';
import { messages } from '../messages';
import type { ThemeId } from '../themes';
import appStyles from '../App.styles';
import { MenuBar } from './menu-bar';
import { dashboardMenuBarModel, type DashboardMenuContext } from './dashboard-menu';
import { DashboardRail } from './DashboardRail';
import {
  DashboardMastheadTrailing,
  DashboardStatusBar,
  useInstanceHealth,
} from './DashboardChrome';
import styles from './DashboardShell.module.css';

const CODA_VERSION = '0.0.6';

export interface DashboardShellProps {
  route: string;
  isAdministrator: boolean;
  theme: ThemeId;
  isFullscreen: boolean;
  displayName?: string;
  updateAvailable?: boolean;
  onNavigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => void;
  logout: () => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}

function HomeContent({
  route,
  isAdministrator,
  accountPage,
  settingsSection,
  adminPage,
  onNavigate,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: {
  route: string;
  isAdministrator: boolean;
  accountPage: AccountPage;
  settingsSection: InstanceSettingsSection;
  adminPage: AdminPage;
  onNavigate: (path: string) => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}) {
  if (isAccountRoute(route)) return <AccountScreen page={accountPage} embedded />;
  if (isInstanceSettingsRoute(route)) {
    return (
      <InstanceSettingsScreen
        section={settingsSection}
        isAdministrator={isAdministrator}
        embedded
        onSectionChange={(section) => onNavigate(instanceSettingsSectionPath(section))}
      />
    );
  }
  if (isAdminRoute(route)) {
    if (isAdministrator) return <AdminScreen page={adminPage} embedded />;
    return (
      <section className={styles.unavailable} role="alert">
        <PulseIcon size={18} aria-hidden />
        <h1>Instance management is unavailable.</h1>
        <p>This area is available only to the instance administrator.</p>
      </section>
    );
  }
  if (route === '/' || route === '/screenplays') {
    return <ScreenplaysScreen onOpen={onOpenScreenplay} />;
  }
  return (
    <ProjectsScreen
      page={route === '/trash' ? 'deleted' : 'overview'}
      embedded
      onOpen={onOpenProject}
      onManage={onManageProject}
      onCreate={onCreateProject}
    />
  );
}

/**
 * The authenticated dashboard shell in the editors' visual language: the shared
 * declarative menu bar, a dense collapsible rail, a panel-frame content
 * container, and the shared status bar — all resolved through the design
 * tokens. Existing pages mount inside the content frame unrestyled; their
 * per-page migrations are tracked separately.
 */
export function DashboardShell({
  route,
  isAdministrator,
  theme,
  isFullscreen,
  displayName,
  updateAvailable = false,
  onNavigate,
  chooseTheme,
  toggleFullscreen,
  logout,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: DashboardShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const toggleRail = useCallback(() => setRailCollapsed((value) => !value), []);
  const health = useInstanceHealth();

  const menuContext: DashboardMenuContext = {
    theme,
    isFullscreen,
    railCollapsed,
    navigate: onNavigate,
    chooseTheme,
    toggleFullscreen,
    toggleRail,
    logout,
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  };

  return (
    <div className={styles.shell}>
      <MenuBar
        model={dashboardMenuBarModel}
        context={menuContext}
        leading={
          <button type="button" onClick={() => onNavigate('/')} className={appStyles.brand}>
            <span className={appStyles.logoMark} aria-hidden />
            <span className={appStyles.visuallyHidden}>{messages.brand}</span>
          </button>
        }
        trailing={
          <DashboardMastheadTrailing
            health={health}
            updateAvailable={updateAvailable}
            displayName={displayName}
            onNavigate={onNavigate}
            onLogout={logout}
          />
        }
      />
      <div className={styles.body}>
        <DashboardRail
          route={route}
          isAdministrator={isAdministrator}
          collapsed={railCollapsed}
          onToggleCollapsed={toggleRail}
          onNavigate={onNavigate}
        />
        <section className={styles.content}>
          <div className={styles.contentBody} key={route}>
            <HomeContent
              route={route}
              isAdministrator={isAdministrator}
              accountPage={accountPageFromRoute(route)}
              settingsSection={instanceSettingsSectionFromRoute(route)}
              adminPage={adminPageFromRoute(route)}
              onNavigate={onNavigate}
              onOpenProject={onOpenProject}
              onManageProject={onManageProject}
              onCreateProject={onCreateProject}
              onOpenScreenplay={onOpenScreenplay}
            />
          </div>
        </section>
      </div>
      <DashboardStatusBar version={CODA_VERSION} health={health} />
    </div>
  );
}
