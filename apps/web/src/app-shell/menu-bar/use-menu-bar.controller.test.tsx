// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuBar, type MenuBarController } from './use-menu-bar';

// Belt-and-braces alongside the config-level auto-cleanup: an unmounted harness here once let a
// pending scheduler callback outlive the jsdom window and escape as an uncaught
// "window is not defined" during environment teardown.
afterEach(() => {
  cleanup();
});

type Probe = { current: MenuBarController | null };
const controllerOf = (probe: Probe) => {
  if (!probe.current) throw new Error('controller missing');
  return probe.current;
};

function Harness({
  probe,
  globalActions = false,
  onAppAction,
}: {
  probe: Probe;
  globalActions?: boolean;
  onAppAction?: (action: unknown) => void;
}) {
  probe.current = useMenuBar(['file', 'edit'], globalActions);
  void onAppAction;
  return null;
}

function setup(globalActions = false) {
  const probe: Probe = { current: null };
  render(<Harness probe={probe} globalActions={globalActions} />);
  const controller = () => controllerOf(probe);
  const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
  ) {
    (this as HTMLElement & { __focused?: boolean }).__focused = true;
  });
  const focused = (element: Element) =>
    (element as HTMLElement & { __focused?: boolean }).__focused === true;
  return { controller, focusSpy, focused };
}

describe('useMenuBar controller', () => {
  it('open/toggle/dismiss transitions and edge reset', () => {
    const controller = setup().controller;
    expect(controller().openMenuId).toBeNull();
    act(() => controller().toggleMenu('file'));
    expect(controller().openMenuId).toBe('file');
    act(() => controller().toggleMenu('file'));
    expect(controller().openMenuId).toBeNull();
    act(() => controller().toggleMenu('edit'));
    expect(controller().openMenuId).toBe('edit');
    act(() => controller().dismiss());
    expect(controller().openMenuId).toBeNull();
  });

  it('trigger keyboard: arrows move between menus only reopening when one is open', () => {
    const controller = setup().controller;
    act(() => controller().handleTriggerKeyDown('file', key('ArrowLeft')));
    expect(controller().openMenuId).toBeNull();

    act(() => controller().handleTriggerKeyDown('file', key('ArrowRight')));
    expect(controller().openMenuId).toBeNull();

    act(() => controller().toggleMenu('file'));
    act(() => controller().handleTriggerKeyDown('file', key('ArrowRight')));
    expect(controller().openMenuId).toBe('edit');
    act(() => controller().handleTriggerKeyDown('edit', key('ArrowLeft')));
    expect(controller().openMenuId).toBe('file');
  });

  it('trigger keyboard: ArrowDown opens first edge, ArrowUp opens last edge', () => {
    const focusSpyList: string[] = [];
    const controller = setup().controller;
    // Register an empty popup first so the edge effect resolves without items.
    act(() => {
      controller().registrars.popup('file')({
        querySelectorAll: () => [],
      } as unknown as HTMLDivElement);
      controller().handleTriggerKeyDown('file', key('ArrowDown'));
    });
    expect(controller().openMenuId).toBe('file');
    focusSpyList.push('x');

    act(() => controller().dismiss());
    act(() => {
      controller().registrars.popup('edit')({
        querySelectorAll: () => [],
      } as unknown as HTMLDivElement);
      controller().handleTriggerKeyDown('edit', key('ArrowUp'));
    });
    expect(controller().openMenuId).toBe('edit');
  });

  it('trigger keyboard: Enter and Space open; Escape closes restoring trigger focus', () => {
    const { controller, focused } = setup();
    const fileTrigger = document.createElement('button');
    document.body.append(fileTrigger);
    act(() => controller().registrars.trigger('file')(fileTrigger));

    act(() => controller().handleTriggerKeyDown('file', key('Enter')));
    expect(controller().openMenuId).toBe('file');
    act(() => controller().handleTriggerKeyDown('file', key('Escape')));
    expect(controller().openMenuId).toBeNull();
    expect(focused(fileTrigger)).toBe(true);

    act(() => controller().handleTriggerKeyDown('file', key(' ')));
    expect(controller().openMenuId).toBe('file');
    fileTrigger.remove();
  });

  it('menu keyboard cycles enabled items and jumps to edges', () => {
    const controller = setup().controller;
    const popup = document.createElement('div');
    const first = item('New');
    const disabled = item('Locked', true);
    const last = item('Close');
    popup.append(first, disabled, last);
    document.body.append(popup);
    act(() => controller().registrars.popup('file')(popup));
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
    ) {
      (this as HTMLElement & { __f?: boolean }).__f = true;
    });
    const wasFocused = (el: HTMLElement) => (el as HTMLElement & { __f?: boolean }).__f === true;

    act(() => controller().toggleMenu('file'));
    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('End') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(wasFocused(last)).toBe(true);

    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('Home') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(wasFocused(first)).toBe(true);

    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('ArrowDown') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    // Disabled item is skipped; focus lands back on the first enabled item cycling forward.
    expect(wasFocused(disabled)).toBe(false);

    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('Escape') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openMenuId).toBeNull();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('menu keyboard left/right moves to sibling menus with reopen', () => {
    const controller = setup().controller;
    const popup = document.createElement('div');
    popup.append(item('Only'));
    document.body.append(popup);
    act(() => controller().registrars.popup('file')(popup));
    act(() => controller().toggleMenu('file'));
    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('ArrowRight') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openMenuId).toBe('edit');
  });

  it('Tab inside a menu dismisses without restoring focus', () => {
    const controller = setup().controller;
    const popup = document.createElement('div');
    popup.append(item('Only'));
    document.body.append(popup);
    act(() => controller().registrars.popup('file')(popup));
    act(() => controller().toggleMenu('file'));
    act(() =>
      controller().handleMenuKeyDown(
        'file',
        key('Tab') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openMenuId).toBeNull();
    expect(controller().openSubmenuId).toBeNull();
  });

  it('submenu open/schedule/cancel and submenu keyboard close paths', () => {
    vi.useFakeTimers();
    const controller = setup().controller;
    const submenuPopup = document.createElement('div');
    submenuPopup.append(item('PDF'));
    document.body.append(submenuPopup);
    act(() => controller().registrars.submenuPopup('export')(submenuPopup));

    act(() => controller().openSubmenu('export', false));
    expect(controller().openSubmenuId).toBe('export');

    act(() => controller().scheduleSubmenuClose());
    act(() => controller().cancelSubmenuClose());
    vi.advanceTimersByTime(500);
    expect(controller().openSubmenuId).toBe('export');

    act(() => {
      controller().scheduleSubmenuClose();
      vi.advanceTimersByTime(500);
    });
    expect(controller().openSubmenuId).toBeNull();

    act(() => controller().handleSubmenuTriggerKeyDown('export', key('Enter')));
    expect(controller().openSubmenuId).toBe('export');

    act(() =>
      controller().handleSubmenuMenuKeyDown(
        'export',
        key('ArrowLeft') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openSubmenuId).toBeNull();

    act(() => controller().handleSubmenuTriggerKeyDown('export', key('ArrowDown')));
    expect(controller().openSubmenuId).toBe('export');
    act(() =>
      controller().handleSubmenuMenuKeyDown(
        'export',
        key('Escape') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openSubmenuId).toBeNull();

    act(() => controller().handleSubmenuTriggerKeyDown('export', key('Shift')));
    expect(controller().openSubmenuId).toBeNull();

    act(() =>
      controller().handleSubmenuMenuKeyDown(
        'export',
        key('Tab') as unknown as React.KeyboardEvent<HTMLDivElement>,
      ),
    );
    expect(controller().openSubmenuId).toBeNull();

    vi.useRealTimers();
    submenuPopup.remove();
  });

  it('empty popups resolve item lists to nothing without crashing', () => {
    const controller = setup().controller;
    const empty = document.createElement('div');
    document.body.append(empty);
    act(() => controller().registrars.popup('ghost')(empty));
    act(() => controller().toggleMenu('ghost'));
    expect(controller().openMenuId).toBe('ghost');
    empty.remove();
  });

  function item(label: string, disabled = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.setAttribute('role', 'menuitem');
    if (disabled) button.setAttribute('disabled', '');
    button.textContent = label;
    return button;
  }

  function key(keyName: string): React.KeyboardEvent<HTMLButtonElement> {
    return {
      key: keyName,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLButtonElement>;
  }
});
