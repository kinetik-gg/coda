import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PushPinSimpleIcon } from '@phosphor-icons/react/dist/csr/PushPinSimple';
import { PushPinSimpleSlashIcon } from '@phosphor-icons/react/dist/csr/PushPinSimpleSlash';
import { handleRailRovingKeyDown } from './rail-keyboard';
import {
  buildWorkingSet,
  useRailScreenplays,
  useScreenplayPins,
  type WorkingSetEntry,
} from './rail-working-set';
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
      title={item.label}
      onClick={() => onNavigate(item.path)}
    >
      <Icon size={12} aria-hidden />
      <span className={styles.railItemLabel}>{item.label}</span>
    </button>
  );
}

function WorkingSetRow({
  entry,
  onOpen,
  onTogglePin,
}: {
  entry: WorkingSetEntry;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  return (
    <div className={styles.railWorkingItem}>
      <button
        type="button"
        data-rail-item
        className={styles.railWorkingOpen}
        title={entry.title}
        onClick={() => onOpen(entry.id)}
      >
        <span>{entry.title}</span>
      </button>
      <button
        type="button"
        className={styles.railWorkingPin}
        aria-pressed={entry.pinned}
        aria-label={entry.pinned ? `Unpin ${entry.title}` : `Pin ${entry.title}`}
        title={entry.pinned ? 'Unpin' : 'Pin'}
        onClick={() => onTogglePin(entry.id)}
      >
        {entry.pinned ? (
          <PushPinSimpleSlashIcon size={11} aria-hidden />
        ) : (
          <PushPinSimpleIcon size={11} aria-hidden />
        )}
      </button>
    </div>
  );
}

/**
 * The rail's working set: recent and pinned screenplays, the "your objects" middle section the
 * reference desktop apps (Codex, Claude Desktop) use their sidebar for. A real object list, not a
 * site map — recency-ordered, filterable, and click-to-open, sharing the `['screenplays']` query
 * cache with the Screenplays list rather than issuing a second request.
 */
function RailWorkingSet({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [filter, setFilter] = useState('');
  const { pinnedIds, togglePin } = useScreenplayPins();
  const screenplays = useRailScreenplays();
  const entries = useMemo(
    () => buildWorkingSet(screenplays.data ?? [], pinnedIds, filter),
    [screenplays.data, pinnedIds, filter],
  );

  return (
    <div className={styles.railGroup}>
      <span className={styles.railGroupLabel}>Screenplays</span>
      <label className={styles.railSearch}>
        <MagnifyingGlassIcon size={11} aria-hidden />
        <input
          type="search"
          data-rail-search
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter"
          aria-label="Filter screenplays"
        />
      </label>
      {screenplays.isLoading ? (
        <p className={styles.railEmpty}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className={styles.railEmpty}>{filter ? 'No matches.' : 'No screenplays yet.'}</p>
      ) : (
        entries.map((entry) => (
          <WorkingSetRow
            key={entry.id}
            entry={entry}
            onOpen={(id) => onNavigate(`/screenplays/${id}`)}
            onTogglePin={togglePin}
          />
        ))
      )}
    </div>
  );
}

/**
 * The dense navigation rail: the Library group (Screenplays, Breakdowns, Trash), the working set of
 * recent and pinned screenplays, and a footer holding the Settings entry point. Account and
 * Administration — 17 rows across 20 — moved to the settings surface (see `SettingsScreen`); the
 * rail is a working set now, not a site map (#163). Account identity lives in the application
 * masthead, so it is not duplicated here.
 *
 * Every item is a real button, so the rail is reachable by Tab, and arrow keys rove focus within
 * the nav for parity with the editors' keyboard-first chrome. Hover and keyboard focus resolve to
 * the same visual state through `:focus-visible`.
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
        <RailWorkingSet onNavigate={onNavigate} />
      </nav>
      <footer className={styles.railFooter}>
        <button
          type="button"
          data-rail-item
          className={styles.railItem}
          aria-current={settingsRailEntry.isActive(route) ? 'page' : undefined}
          title={settingsRailEntry.label}
          onClick={() => onNavigate(settingsRailEntry.path)}
        >
          <SettingsIcon size={12} aria-hidden />
          <span className={styles.railItemLabel}>{settingsRailEntry.label}</span>
        </button>
      </footer>
    </aside>
  );
}
