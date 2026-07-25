import { useCallback, type KeyboardEvent } from 'react';
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { railGroups, type RailItem } from './nav-model';
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
      className={`${styles.railItem} ${item.sub ? styles.railItemSub : ''}`}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      onClick={() => onNavigate(item.path)}
    >
      <Icon size={12} aria-hidden />
      <span className={styles.railItemLabel}>{item.label}</span>
    </button>
  );
}

/**
 * The dense navigation rail. Groups mirror the surfaces the shell hosts
 * (library / account / administration); the instance-settings sections are
 * flattened as administration sub-items. Every item is a real button, so the
 * rail is reachable by Tab, and arrow keys rove focus within it for parity
 * with the editors' keyboard-first chrome. Hover and keyboard focus resolve to
 * the same visual state through `:focus-visible`.
 */
export function DashboardRail({
  route,
  isAdministrator,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  route: string;
  isAdministrator: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (path: string) => void;
}) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const container = event.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-rail-item]'));
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const groups = railGroups.filter((group) => !group.adminOnly || isAdministrator);
  return (
    <aside className={`${styles.rail} ${collapsed ? styles.railCollapsed : ''}`}>
      <div className={styles.railTop}>
        <button
          type="button"
          className={styles.railToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          <SidebarSimpleIcon size={12} aria-hidden />
        </button>
      </div>
      <nav className={styles.railNav} aria-label="Coda pages" onKeyDown={handleKeyDown}>
        {groups.map((group) => (
          <div key={group.id} className={styles.railGroup}>
            <span className={styles.railGroupLabel} aria-hidden={collapsed}>
              {group.label}
            </span>
            {group.items.map((item) => (
              <RailButton key={item.id} item={item} route={route} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
      <footer className={styles.railFooter}>© Kinetik Coda</footer>
    </aside>
  );
}
