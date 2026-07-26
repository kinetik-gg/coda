import { handleRailRovingKeyDown } from '../app-shell/rail-keyboard';
import { settingsGroups } from '../app-shell/nav-model';
import styles from './SettingsSidebar.module.css';

/**
 * The settings surface's own two-level left sub-nav: Account always, Administration and Instance
 * Settings only for the instance administrator. Two levels means the group heading (Account /
 * Administration / Instance Settings) and the pages within it — the same declarations
 * `app-shell/nav-model.ts` feeds to breadcrumbs and the command palette, so this list can never
 * drift from what those surfaces think exists.
 *
 * Instance Settings renders as its own group rather than nested under Administration, which is what
 * lets its pages drop the `Settings:` label prefix (#163): "Storage" under "Administration" and
 * "Storage" under "Instance Settings" are disambiguated by the heading above them, not by text
 * baked into the label.
 */
export function SettingsSidebar({
  route,
  isAdministrator,
  onNavigate,
}: {
  route: string;
  isAdministrator: boolean;
  onNavigate: (path: string) => void;
}) {
  const groups = settingsGroups.filter((group) => !group.adminOnly || isAdministrator);
  return (
    <aside className={styles.sidebar} aria-label="Settings pages">
      <nav className={styles.sidebarNav} onKeyDown={handleRailRovingKeyDown}>
        {groups.map((group) => (
          <div key={group.id} className={styles.sidebarGroup}>
            <span className={styles.sidebarGroupLabel}>{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.isActive(route);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-rail-item
                  className={styles.sidebarItem}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.path)}
                >
                  <Icon size={12} aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
