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
 * reachable at its existing, deep-linkable route.
 *
 * It renders content only. Its navigation is the application sidebar, which swaps to the settings
 * groups on these routes (#193) — this screen used to open a second sidebar beside the first, and
 * a sidebar nested in a sidebar is two answers to "where am I".
 */
export function SettingsScreen({
  route,
  isAdministrator,
}: {
  route: string;
  isAdministrator: boolean;
}) {
  return (
    <div className={styles.surface}>
      <SettingsContent route={route} isAdministrator={isAdministrator} />
    </div>
  );
}
