import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { FilmStripIcon } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SpaceSummary } from '../api';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../components/DropdownMenu';
import { CreateSpaceDialog } from '../spaces/CreateSpaceDialog';
import { useMenuBar } from './menu-bar/use-menu-bar';
import styles from './DashboardShell.module.css';

const SWITCHER_MENU_ID = 'space-switcher';

/** Arrow keys belong to the rail's roving focus while the trigger is closed, not to the menu. */
const RAIL_ROVING_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

/**
 * The sidebar's Space scope control.
 *
 * It is the same dropdown the panel headers and the menu bars use — `DropdownMenu` driven by the
 * shared `useMenuBar` controller — rather than a bespoke disclosure. The earlier revision rendered
 * the Space list as an ordinary block inside the rail, so opening it *reflowed* the sidebar and
 * pushed the Library list down the page (#338). A portalled, absolutely positioned popup floats
 * over the rail instead, and nothing beneath it moves. Adopting the shared controller brings the
 * rest of the pattern with it: outside-pointer dismissal, `Escape` restoring focus to the trigger,
 * arrow/Home/End roving inside the popup, and `Tab` closing it.
 *
 * The trigger keeps `data-rail-item` and yields the arrow keys to the rail's own roving focus while
 * closed, so the sidebar's keyboard model is unchanged; `Enter`/`Space` opens the menu and moves
 * focus into it.
 *
 * "Create Space" lives here because this is where a person looks for one (#335). Every instance
 * ships with a single seeded Default Space that has no memberships, so without this entry the whole
 * Spaces feature — roles, invitations, resource moves — had no Space anyone could administer.
 */
export function SpaceSwitcher({
  activeSpace,
  spaces,
  onSelectSpace,
  onNavigate,
}: {
  activeSpace?: SpaceSummary;
  spaces: readonly SpaceSummary[];
  onSelectSpace: (spaceId: string) => void;
  onNavigate: (path: string) => void;
}) {
  const menu = useMenuBar([SWITCHER_MENU_ID], false);
  const [creating, setCreating] = useState(false);
  if (!activeSpace) return null;

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (RAIL_ROVING_KEYS.has(event.key)) return;
    menu.handleTriggerKeyDown(SWITCHER_MENU_ID, event);
  };

  return (
    <div className={styles.spaceSwitcher}>
      <div className={styles.spaceSwitcherControls}>
        <DropdownMenu
          portal
          id={SWITCHER_MENU_ID}
          ariaLabel={activeSpace.name}
          open={menu.openMenuId === SWITCHER_MENU_ID}
          className={styles.spaceSwitcherMenu}
          triggerClassName={styles.spaceSwitcherButton}
          popupClassName={styles.spaceSwitcherPopup}
          triggerData={{ 'data-rail-item': '' }}
          triggerRef={menu.registrars.trigger(SWITCHER_MENU_ID)}
          popupRef={menu.registrars.popup(SWITCHER_MENU_ID)}
          onToggle={() => menu.toggleMenu(SWITCHER_MENU_ID)}
          onTriggerKeyDown={handleTriggerKeyDown}
          onMenuKeyDown={(event) => menu.handleMenuKeyDown(SWITCHER_MENU_ID, event)}
          label={
            <>
              <FilmStripIcon size={16} aria-hidden />
              <span className={styles.railItemLabel}>{activeSpace.name}</span>
              <CaretUpDownIcon size={12} aria-hidden />
            </>
          }
        >
          {spaces.map((space) => (
            <DropdownMenuItem
              key={space.id}
              dismiss={menu.dismiss}
              ariaCurrent={space.id === activeSpace.id}
              onSelect={() => onSelectSpace(space.id)}
            >
              <span className={styles.spaceOption}>
                <FilmStripIcon size={12} aria-hidden />
                <span className={styles.railItemLabel}>{space.name}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem dismiss={menu.dismiss} onSelect={() => setCreating(true)}>
            <span className={styles.spaceOption}>
              <PlusIcon size={12} aria-hidden />
              <span className={styles.railItemLabel}>Create Space</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenu>
        <button
          type="button"
          data-rail-item
          className={styles.spaceSettingsButton}
          aria-label={`Manage ${activeSpace.name} Space`}
          onClick={() => onNavigate(`/spaces/${activeSpace.id}/manage`)}
        >
          <GearSixIcon size={16} aria-hidden />
        </button>
      </div>
      {creating && (
        <CreateSpaceDialog
          onCreated={(spaceId) => {
            onSelectSpace(spaceId);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
