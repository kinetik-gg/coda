import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { AccountScreen } from './AccountScreen';
import { AdminScreen } from './AdminScreen';
import {
  accountPageFromRoute,
  adminPageFromRoute,
  instanceSettingsSectionFromRoute,
  isAccountRoute,
  isAdminRoute,
  isInstanceSettingsRoute,
} from './app-routing';
import { InstanceSettingsScreen } from './instance-settings/InstanceSettingsScreen';
import { SettingsSidebar } from './settings/SettingsSidebar';
import styles from './SettingsScreen.module.css';

function SettingsContent({ route, isAdministrator }: { route: string; isAdministrator: boolean }) {
  if (isAccountRoute(route)) {
    return <AccountScreen page={accountPageFromRoute(route)} embedded />;
  }
  if (isInstanceSettingsRoute(route)) {
    return (
      <InstanceSettingsScreen
        section={instanceSettingsSectionFromRoute(route)}
        isAdministrator={isAdministrator}
        embedded
      />
    );
  }
  if (isAdminRoute(route)) {
    if (isAdministrator) return <AdminScreen page={adminPageFromRoute(route)} embedded />;
    return (
      <section className={styles.unavailable} role="alert">
        <PulseIcon size={18} aria-hidden />
        <h1>Instance management is unavailable.</h1>
        <p>This area is available only to the instance administrator.</p>
      </section>
    );
  }
  return null;
}

/**
 * The settings surface (#163): Account and Administration behind one entry point, each page still
 * reachable at its existing, deep-linkable route. A left sub-nav — grouped Account / Administration
 * / Instance Settings, the same declarations `app-shell/nav-model.ts` feeds to the rail and the
 * command palette — replaces the 17 rows those surfaces used to occupy on the dashboard rail.
 *
 * Every mounted page keeps rendering its own panel-frame header (breadcrumbs resolved from the same
 * nav declarations) and its own body; only its navigation moves here. Pages mount `embedded` so they
 * render none of their own — this surface is the single place that navigation now lives.
 */
export function SettingsScreen({
  route,
  isAdministrator,
  onNavigate,
}: {
  route: string;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className={styles.shell}>
      <SettingsSidebar route={route} isAdministrator={isAdministrator} onNavigate={onNavigate} />
      <div className={styles.surface}>
        <SettingsContent route={route} isAdministrator={isAdministrator} />
      </div>
    </div>
  );
}
