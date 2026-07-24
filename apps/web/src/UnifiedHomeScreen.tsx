import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/csr/EnvelopeSimple';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { GaugeIcon } from '@phosphor-icons/react/dist/csr/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { LockKeyIcon } from '@phosphor-icons/react/dist/csr/LockKey';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import { AccountScreen } from './AccountScreen';
import type { AccountPage } from './account-validation';
import { AdminScreen } from './AdminScreen';
import type { AdminPage } from './admin/types';
import { InstanceSettingsScreen } from './instance-settings/InstanceSettingsScreen';
import type { InstanceSettingsSection } from './instance-settings/types';
import { ProjectsScreen } from './ProjectsScreen';
import { ScreenplaysScreen } from './ScreenplaysScreen';
import {
  accountPageFromRoute,
  adminPageFromRoute,
  instanceSettingsSectionFromRoute,
  instanceSettingsSectionPath,
  isAccountRoute,
  isAdminRoute,
  isInstanceSettingsRoute,
} from './app-routing';
import styles from './UnifiedHomeScreen.module.css';

function HomeContent({
  isAccount,
  accountPage,
  isInstanceSettings,
  settingsSection,
  isAdmin,
  isAdministrator,
  adminPage,
  isScreenplays,
  isTrash,
  onNavigate,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: {
  isAccount: boolean;
  accountPage: AccountPage;
  isInstanceSettings: boolean;
  settingsSection: InstanceSettingsSection;
  isAdmin: boolean;
  isAdministrator: boolean;
  adminPage: AdminPage;
  isScreenplays: boolean;
  isTrash: boolean;
  onNavigate: (path: string) => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}) {
  if (isAccount) return <AccountScreen page={accountPage} embedded />;
  if (isInstanceSettings) {
    return (
      <InstanceSettingsScreen
        section={settingsSection}
        isAdministrator={isAdministrator}
        embedded
        onSectionChange={(section) => onNavigate(instanceSettingsSectionPath(section))}
      />
    );
  }
  if (isAdmin) {
    if (isAdministrator) return <AdminScreen page={adminPage} embedded />;
    return (
      <section className={styles.unavailable} role="alert">
        <PulseIcon size={18} aria-hidden="true" />
        <h1>Instance management is unavailable.</h1>
        <p>This area is available only to the instance administrator.</p>
      </section>
    );
  }
  if (isScreenplays) return <ScreenplaysScreen onOpen={onOpenScreenplay} />;
  return (
    <ProjectsScreen
      page={isTrash ? 'deleted' : 'overview'}
      embedded
      onOpen={onOpenProject}
      onManage={onManageProject}
      onCreate={onCreateProject}
    />
  );
}

function SidebarLink({
  active,
  nested = false,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  nested?: boolean;
  icon: typeof FolderOpenIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.sidebarLink} ${nested ? styles.nestedLink : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function UnifiedHomeScreen({
  route,
  isAdministrator,
  onNavigate,
  onOpenProject,
  onManageProject,
  onCreateProject,
  onOpenScreenplay,
}: {
  route: string;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
  onOpenProject: (id: string) => void;
  onManageProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenScreenplay: (id: string) => void;
}) {
  const isTrash = route === '/trash';
  const isAccount = isAccountRoute(route);
  const isAdmin = isAdminRoute(route);
  const isInstanceSettings = isInstanceSettingsRoute(route);
  const accountPage = accountPageFromRoute(route);
  const adminPage = adminPageFromRoute(route);
  const settingsSection = instanceSettingsSectionFromRoute(route);
  const isScreenplays = route === '/' || route === '/screenplays';

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Coda pages">
          <nav className={styles.sidebarNav}>
            <SidebarLink
              active={isScreenplays}
              icon={BookOpenTextIcon}
              label="Screenplays"
              onClick={() => onNavigate('/')}
            />
            <SidebarLink
              active={route === '/breakdowns'}
              icon={FolderOpenIcon}
              label="Breakdowns"
              onClick={() => onNavigate('/breakdowns')}
            />
            <SidebarLink
              active={isTrash}
              icon={TrashIcon}
              label="Trash"
              onClick={() => onNavigate('/trash')}
            />

            <div className={styles.sidebarSection}>
              <SidebarLink
                active={route === '/account'}
                icon={UserCircleIcon}
                label="Profile"
                onClick={() => onNavigate('/account')}
              />
              <SidebarLink
                active={route === '/account/preferences'}
                nested
                icon={SlidersHorizontalIcon}
                label="Preferences"
                onClick={() => onNavigate('/account/preferences')}
              />
              <SidebarLink
                active={route === '/account/security'}
                nested
                icon={LockKeyIcon}
                label="Security"
                onClick={() => onNavigate('/account/security')}
              />
              <SidebarLink
                active={route === '/account/developer'}
                nested
                icon={KeyIcon}
                label="Developer"
                onClick={() => onNavigate('/account/developer')}
              />
            </div>

            {isAdministrator && (
              <div className={styles.sidebarSection}>
                <SidebarLink
                  active={route === '/admin'}
                  icon={BuildingsIcon}
                  label="Instance"
                  onClick={() => onNavigate('/admin')}
                />
                <SidebarLink
                  active={route === '/admin/projects'}
                  nested
                  icon={FolderOpenIcon}
                  label="Breakdowns"
                  onClick={() => onNavigate('/admin/projects')}
                />
                <SidebarLink
                  active={route === '/admin/users'}
                  nested
                  icon={UsersIcon}
                  label="Users"
                  onClick={() => onNavigate('/admin/users')}
                />
                <SidebarLink
                  active={route === '/admin/storage'}
                  nested
                  icon={DatabaseIcon}
                  label="Storage"
                  onClick={() => onNavigate('/admin/storage')}
                />
                <SidebarLink
                  active={route === '/admin/jobs'}
                  nested
                  icon={GaugeIcon}
                  label="Jobs"
                  onClick={() => onNavigate('/admin/jobs')}
                />
                <SidebarLink
                  active={route === '/admin/audit'}
                  nested
                  icon={ClipboardTextIcon}
                  label="Audit"
                  onClick={() => onNavigate('/admin/audit')}
                />
                <SidebarLink
                  active={route === '/admin/invitations'}
                  nested
                  icon={EnvelopeSimpleIcon}
                  label="Invitations"
                  onClick={() => onNavigate('/admin/invitations')}
                />
                <SidebarLink
                  active={isInstanceSettings}
                  nested
                  icon={GearSixIcon}
                  label="Settings"
                  onClick={() => onNavigate(instanceSettingsSectionPath('general'))}
                />
              </div>
            )}
          </nav>
          <footer className={styles.sidebarFooter}>
            <span>© Kinetik Coda</span>
            <nav aria-label="Coda links">
              <a href="https://github.com/kinetik-gg/coda" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <a href="https://coda.github.io" target="_blank" rel="noreferrer">
                Docs
              </a>
            </nav>
          </footer>
        </aside>

        <div className={styles.content} key={route}>
          <HomeContent
            isAccount={isAccount}
            accountPage={accountPage}
            isInstanceSettings={isInstanceSettings}
            settingsSection={settingsSection}
            isAdmin={isAdmin}
            isAdministrator={isAdministrator}
            adminPage={adminPage}
            isScreenplays={isScreenplays}
            isTrash={isTrash}
            onNavigate={onNavigate}
            onOpenProject={onOpenProject}
            onManageProject={onManageProject}
            onCreateProject={onCreateProject}
            onOpenScreenplay={onOpenScreenplay}
          />
        </div>
      </div>
    </main>
  );
}
