import { handleRailRovingKeyDown } from './rail-keyboard';
import { railGroups, settingsRailEntry, type RailItem } from './nav-model';
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

/**
 * The navigation sidebar: the Library destinations and a pinned Settings entry.
 *
 * It is a *navigational* surface, not a second content list. An earlier revision carried a
 * recency-and-pinning working set of screenplays here, which duplicated the list beside it,
 * offered no equivalent for breakdowns, and brought a second search box the content header
 * already provided (#193). Objects belong in the content plane; this sidebar says where you are.
 *
 * Every item is a real button, so the sidebar is reachable by Tab, and arrow keys rove focus
 * within the nav for parity with the editors' keyboard-first chrome. Hover and keyboard focus
 * resolve to the same visual state through `:focus-visible`.
 */
export function DashboardRail({
  route,
  width,
  onNavigate,
}: {
  route: string;
  width: number;
  onNavigate: (path: string) => void;
}) {
  const SettingsIcon = settingsRailEntry.icon;
  return (
    <aside className={styles.rail} style={{ width }} aria-label="Sidebar">
      <nav className={styles.railNav} aria-label="Coda pages" onKeyDown={handleRailRovingKeyDown}>
        {railGroups.map((group) => (
          <div key={group.id} className={styles.railGroup}>
            <span className={styles.railGroupLabel}>{group.label}</span>
            {group.items.map((item) => (
              <RailButton key={item.id} item={item} route={route} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
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
    </aside>
  );
}
