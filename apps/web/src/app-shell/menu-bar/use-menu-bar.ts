import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { actionForKeyboardEvent, dispatchAppAction } from '../../keybindings';

type FocusEdge = 'first' | 'last';

const PARENT_ITEM_SELECTOR =
  ':scope > [role="menuitem"]:not([disabled]), :scope > [data-app-submenu] > [role="menuitem"]:not([disabled])';
const SUBMENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const SUBMENU_CLOSE_DELAY_MS = 400;

function focusEdge(items: HTMLElement[], edge: FocusEdge) {
  (edge === 'last' ? items.at(-1) : items[0])?.focus();
}

function cycle(items: HTMLElement[], step: -1 | 1) {
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[(index + step + items.length) % items.length]?.focus();
}

/**
 * The single menu-bar controller extracted from the breakdown masthead — the
 * keyboard-navigation gold standard — and generalised over arbitrary menu ids
 * and nested submenus. It owns open/close state, roving focus across triggers
 * and items, submenu hover/keyboard behaviour, outside-pointer dismissal, and
 * (opt-in) global keybinding dispatch.
 */
export function useMenuBar(menuOrder: readonly string[], globalActions: boolean) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [menuFocusEdge, setMenuFocusEdge] = useState<FocusEdge | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const popups = useRef(new Map<string, HTMLDivElement>());
  const submenuTriggers = useRef(new Map<string, HTMLButtonElement>());
  const submenuPopups = useRef(new Map<string, HTMLDivElement>());
  const closeTimer = useRef<number | undefined>(undefined);

  const menuItems = useCallback((id: string): HTMLElement[] => {
    const popup = popups.current.get(id);
    return popup ? Array.from(popup.querySelectorAll<HTMLElement>(PARENT_ITEM_SELECTOR)) : [];
  }, []);
  const submenuItems = useCallback((id: string): HTMLElement[] => {
    const popup = submenuPopups.current.get(id);
    return popup ? Array.from(popup.querySelectorAll<HTMLElement>(SUBMENU_ITEM_SELECTOR)) : [];
  }, []);

  const cancelSubmenuClose = useCallback(() => {
    if (closeTimer.current === undefined) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const scheduleSubmenuClose = useCallback(() => {
    cancelSubmenuClose();
    closeTimer.current = window.setTimeout(() => {
      setOpenSubmenuId(null);
      closeTimer.current = undefined;
    }, SUBMENU_CLOSE_DELAY_MS);
  }, [cancelSubmenuClose]);
  const openSubmenu = useCallback(
    (id: string, focusFirst = false) => {
      cancelSubmenuClose();
      setOpenSubmenuId(id);
      if (focusFirst) requestAnimationFrame(() => submenuItems(id)[0]?.focus());
    },
    [cancelSubmenuClose, submenuItems],
  );

  const openMenu = useCallback((id: string, edge: FocusEdge | null = null) => {
    setOpenSubmenuId(null);
    setMenuFocusEdge(edge);
    setOpenMenuId(id);
  }, []);
  const dismiss = useCallback((restoreFocus = false) => {
    setOpenMenuId((current) => {
      if (restoreFocus && current) triggers.current.get(current)?.focus();
      return null;
    });
    setMenuFocusEdge(null);
    setOpenSubmenuId(null);
  }, []);
  const toggleMenu = useCallback(
    (id: string) => (openMenuId === id ? dismiss() : openMenu(id)),
    [dismiss, openMenu, openMenuId],
  );

  const moveTopLevel = useCallback(
    (from: string, step: -1 | 1, openNext: boolean) => {
      const index = menuOrder.indexOf(from);
      const nextId = menuOrder[(index + step + menuOrder.length) % menuOrder.length]!;
      triggers.current.get(nextId)?.focus();
      if (openNext) openMenu(nextId, 'first');
      else dismiss();
    },
    [dismiss, menuOrder, openMenu],
  );

  const handleTriggerKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTopLevel(id, event.key === 'ArrowRight' ? 1 : -1, openMenuId !== null);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(id, event.key === 'ArrowDown' ? 'first' : 'last');
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu(id, 'first');
      } else if (event.key === 'Escape' && openMenuId) {
        event.preventDefault();
        dismiss(true);
      }
    },
    [dismiss, moveTopLevel, openMenu, openMenuId],
  );

  const handleMenuKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = menuItems(id);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        cycle(items, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusEdge(items, event.key === 'Home' ? 'first' : 'last');
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTopLevel(id, event.key === 'ArrowRight' ? 1 : -1, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        dismiss(true);
      } else if (event.key === 'Tab') {
        dismiss();
      }
    },
    [dismiss, menuItems, moveTopLevel],
  );

  const handleSubmenuTriggerKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!['ArrowRight', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      openSubmenu(id, true);
    },
    [openSubmenu],
  );

  const handleSubmenuMenuKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = submenuItems(id);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        cycle(items, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        focusEdge(items, event.key === 'Home' ? 'first' : 'last');
      } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpenSubmenuId(null);
        requestAnimationFrame(() => submenuTriggers.current.get(id)?.focus());
      } else if (event.key === 'Tab') {
        dismiss();
      }
    },
    [dismiss, submenuItems],
  );

  useEffect(() => () => cancelSubmenuClose(), [cancelSubmenuClose]);
  useEffect(() => {
    if (!openMenuId || !menuFocusEdge) return;
    const frame = requestAnimationFrame(() => {
      focusEdge(menuItems(openMenuId), menuFocusEdge);
      setMenuFocusEdge(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [menuFocusEdge, menuItems, openMenuId]);
  useEffect(() => {
    if (!openMenuId) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-dropdown-menu]')) {
        dismiss();
      }
    };
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer);
  }, [dismiss, openMenuId]);
  useEffect(() => {
    if (!globalActions) return;
    const handleKeybinding = (event: KeyboardEvent) => {
      const action = actionForKeyboardEvent(event);
      if (!action) return;
      event.preventDefault();
      dismiss();
      dispatchAppAction(action);
    };
    window.addEventListener('keydown', handleKeybinding);
    return () => window.removeEventListener('keydown', handleKeybinding);
  }, [dismiss, globalActions]);

  const registrars = useMemo(() => {
    const bind =
      <E extends HTMLElement>(map: Map<string, E>, id: string) =>
      (element: E | null) => {
        if (element) map.set(id, element);
        else map.delete(id);
      };
    return {
      trigger: (id: string) => bind(triggers.current, id),
      popup: (id: string) => bind(popups.current, id),
      submenuTrigger: (id: string) => bind(submenuTriggers.current, id),
      submenuPopup: (id: string) => bind(submenuPopups.current, id),
    };
  }, []);

  return {
    openMenuId,
    openSubmenuId,
    registrars,
    dismiss,
    toggleMenu,
    handleTriggerKeyDown,
    handleMenuKeyDown,
    openSubmenu,
    scheduleSubmenuClose,
    cancelSubmenuClose,
    handleSubmenuTriggerKeyDown,
    handleSubmenuMenuKeyDown,
  };
}

export type MenuBarController = ReturnType<typeof useMenuBar>;
