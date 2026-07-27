import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { isAccountRoute, isAdminRoute, isInstanceSettingsRoute } from '../app-routing';
import { handleRailRovingKeyDown } from './rail-keyboard';
import { railGroups, settingsGroups, settingsRailEntry, type RailItem } from './nav-model';
import styles from './DashboardShell.module.css';

function RailButton({
  item,
  route,
  onNavigate,
}: {
  item: RailItem;
  route: string;
  onNavigate: (path: string) => void;
}) {
  const Icon = item.icon;
  const active = item.isActive(route);
  return (
    <button
      type="button"
      data-rail-item
      className={styles.railItem}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item.path)}
    >
      <Icon size={16} aria-hidden />
      <span className={styles.railItemLabel}>{item.label}</span>
    </button>
  );
}

function isSettingsRoute(route: string): boolean {
  return isAccountRoute(route) || isAdminRoute(route) || isInstanceSettingsRoute(route);
}

/**
 * The navigation sidebar.
 *
 * It is a *navigational* surface, not a second content list. An earlier revision carried a
 * recency-and-pinning working set of screenplays here, which duplicated the list beside it,
 * offered no equivalent for breakdowns, and brought a second search box the content header
 * already provided (#193). Objects belong in the content plane; this sidebar says where you are.
 *
 * On settings routes it *becomes* the settings navigation rather than letting the settings
 * surface open a sidebar of its own beside it. One window, one navigation surface: a sidebar
 * nested inside a sidebar is two answers to the same question, and it was the thing that made
 * the settings screen read as an unfinished page (#193).
 *
 * Every item is a real button, so the sidebar is reachable by Tab, and arrow keys rove focus
 * within the nav for parity with the editors' keyboard-first chrome. Hover and keyboard focus
 * resolve to the same visual state through `:focus-visible`.
 */
export function DashboardRail({
  route,
  width,
  isAdministrator,
  onNavigate,
}: {
  route: string;
  width: number;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
}) {
  const settings = isSettingsRoute(route);
  const groups = settings
    ? settingsGroups.filter((group) => !group.adminOnly || isAdministrator)
    : railGroups;
  const SettingsIcon = settingsRailEntry.icon;

  return (
    <aside className={styles.rail} style={{ width }} aria-label="Sidebar">
      <nav
        className={styles.railNav}
        aria-label={settings ? 'Settings pages' : 'Coda pages'}
        onKeyDown={handleRailRovingKeyDown}
      >
        {settings && (
          <button
            type="button"
            data-rail-item
            className={styles.railBack}
            onClick={() => onNavigate('/')}
          >
            <ArrowLeftIcon size={16} aria-hidden />
            <span className={styles.railItemLabel}>Library</span>
          </button>
        )}
        {groups.map((group) => (
          <div key={group.id} className={styles.railGroup} data-rail-group={group.id}>
            <span className={styles.railGroupLabel}>{group.label}</span>
            {group.items.map((item) => (
              <RailButton key={item.id} item={item} route={route} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
      {!settings && (
        <footer className={styles.railFooter}>
          <button
            type="button"
            data-rail-item
            className={styles.railItem}
            aria-current={settingsRailEntry.isActive(route) ? 'page' : undefined}
            onClick={() => onNavigate(settingsRailEntry.path)}
          >
            <SettingsIcon size={16} aria-hidden />
            <span className={styles.railItemLabel}>{settingsRailEntry.label}</span>
          </button>
        </footer>
      )}
    </aside>
  );
}
