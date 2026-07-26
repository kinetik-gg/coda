import type { KeyboardEvent } from 'react';

/**
 * Arrow-key roving focus shared by the dashboard rail (`DashboardRail`) and the settings surface's
 * sub-nav (`settings/SettingsSidebar`): Up/Down moves between `[data-rail-item]` buttons, Home/End
 * jump to the ends. Attach to the containing `<nav>`'s `onKeyDown`.
 *
 * Ignored while focus sits in a `[data-rail-search]` field, except ArrowDown, which enters the list
 * from the top — the same from-search-into-results step a combobox uses — so Home/End/typing keep
 * their native text-editing meaning inside the filter box.
 */
export function handleRailRovingKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const active = document.activeElement;
  const inSearch = active instanceof HTMLElement && active.hasAttribute('data-rail-search');
  if (inSearch && event.key !== 'ArrowDown') return;
  if (!inSearch && !(active instanceof HTMLElement && active.hasAttribute('data-rail-item'))) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-rail-item]'));
  if (items.length === 0) return;
  event.preventDefault();

  const index = inSearch ? -1 : items.indexOf(active as HTMLElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
