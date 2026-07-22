import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { FilmReelIcon } from '@phosphor-icons/react/dist/csr/FilmReel';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { UserCircleIcon } from '@phosphor-icons/react/dist/csr/UserCircle';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../components/DropdownMenu';
import { Skeleton } from '../components/Skeleton';
import {
  dispatchAppAction,
  getKeybindingLabel,
  type AppActionId,
  actionForKeyboardEvent,
} from '../keybindings';
import { messages } from '../messages';
import { themes, type ThemeId } from '../themes';
import { WorkspaceLoadingSkeleton } from '../workspace/WorkspaceLoadingSkeleton';
import styles from '../App.styles';

export interface ProjectSummary {
  id: string;
  name: string;
}

type ApplicationMenuId = 'file' | 'edit' | 'view' | 'workspace' | 'project';

interface ApplicationMenuProps {
  id: ApplicationMenuId;
  label: ReactNode;
  open: boolean;
  className?: string;
  popupClassName?: string;
  triggerRef: (element: HTMLButtonElement | null) => void;
  popupRef: (element: HTMLDivElement | null) => void;
  onToggle: () => void;
  onTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

function ApplicationMenu({
  id,
  label,
  open,
  className,
  popupClassName,
  triggerRef,
  popupRef,
  onToggle,
  onTriggerKeyDown,
  onMenuKeyDown,
  children,
}: ApplicationMenuProps) {
  return (
    <DropdownMenu
      id={`application-menu-${id}`}
      label={label}
      open={open}
      className={`${styles.appMenu} ${className ?? ''}`}
      triggerClassName={styles.menuTrigger}
      popupClassName={`${styles.appMenuPopup} ${popupClassName ?? ''}`}
      align={id === 'project' ? 'end' : 'start'}
      rootRole="none"
      triggerRole="menuitem"
      triggerRef={triggerRef}
      popupRef={popupRef}
      onToggle={onToggle}
      onTriggerKeyDown={onTriggerKeyDown}
      onMenuKeyDown={onMenuKeyDown}
    >
      {children}
    </DropdownMenu>
  );
}

function ApplicationMenuItem({
  children,
  onSelect,
  dismiss,
  actionId,
  shortcut: shortcutOverride,
  dismissOnSelect = true,
}: {
  children: ReactNode;
  onSelect: () => void;
  dismiss: () => void;
  actionId?: AppActionId;
  shortcut?: string;
  dismissOnSelect?: boolean;
}) {
  const shortcut = shortcutOverride ?? (actionId ? getKeybindingLabel(actionId) : undefined);
  return (
    <DropdownMenuItem
      shortcut={shortcut}
      dismiss={dismiss}
      dismissOnSelect={dismissOnSelect}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuItem>
  );
}

interface MenuController {
  openMenuId: ApplicationMenuId | null;
  editThemeOpen: boolean;
  triggerRefs: React.RefObject<Map<ApplicationMenuId, HTMLButtonElement>>;
  popupRefs: React.RefObject<Map<ApplicationMenuId, HTMLDivElement>>;
  themeTriggerRef: React.RefObject<HTMLButtonElement | null>;
  themePopupRef: React.RefObject<HTMLDivElement | null>;
  openApplicationMenu: (id: ApplicationMenuId) => void;
  dismissApplicationMenu: (restoreFocus?: boolean) => void;
  handleTriggerKeyDown: (
    id: ApplicationMenuId,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
  handleMenuKeyDown: (id: ApplicationMenuId, event: ReactKeyboardEvent<HTMLDivElement>) => void;
  openThemeSubmenu: (focusFirst?: boolean) => void;
  scheduleThemeSubmenuClose: () => void;
  cancelThemeSubmenuClose: () => void;
  handleThemeTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  handleThemeMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

function useMenuController(): MenuController {
  const menuOrder = useMemo<ApplicationMenuId[]>(
    () => ['file', 'edit', 'view', 'workspace', 'project'],
    [],
  );
  const [openMenuId, setOpenMenuId] = useState<ApplicationMenuId | null>(null);
  const [editThemeOpen, setEditThemeOpen] = useState(false);
  const [menuFocusEdge, setMenuFocusEdge] = useState<'first' | 'last' | null>(null);
  const triggerRefs = useRef(new Map<ApplicationMenuId, HTMLButtonElement>());
  const popupRefs = useRef(new Map<ApplicationMenuId, HTMLDivElement>());
  const themeTriggerRef = useRef<HTMLButtonElement>(null);
  const themePopupRef = useRef<HTMLDivElement>(null);
  const themeCloseTimerRef = useRef<number | undefined>(undefined);

  const menuItems = useCallback((id: ApplicationMenuId) => {
    const popup = popupRefs.current.get(id);
    return popup
      ? Array.from(
          popup.querySelectorAll<HTMLElement>(
            ':scope > [role="menuitem"]:not([disabled]), :scope > [data-app-submenu] > [role="menuitem"]:not([disabled])',
          ),
        )
      : [];
  }, []);
  const themeMenuItems = useCallback(
    () =>
      themePopupRef.current
        ? Array.from(
            themePopupRef.current.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not([disabled])',
            ),
          )
        : [],
    [],
  );
  const cancelThemeSubmenuClose = useCallback(() => {
    if (themeCloseTimerRef.current === undefined) return;
    window.clearTimeout(themeCloseTimerRef.current);
    themeCloseTimerRef.current = undefined;
  }, []);
  const scheduleThemeSubmenuClose = useCallback(() => {
    cancelThemeSubmenuClose();
    themeCloseTimerRef.current = window.setTimeout(() => {
      setEditThemeOpen(false);
      themeCloseTimerRef.current = undefined;
    }, 400);
  }, [cancelThemeSubmenuClose]);
  const openThemeSubmenu = useCallback(
    (focusFirst = false) => {
      cancelThemeSubmenuClose();
      setEditThemeOpen(true);
      if (focusFirst) requestAnimationFrame(() => themeMenuItems()[0]?.focus());
    },
    [cancelThemeSubmenuClose, themeMenuItems],
  );
  const openApplicationMenu = useCallback((id: ApplicationMenuId) => {
    if (id !== 'edit') setEditThemeOpen(false);
    setMenuFocusEdge(null);
    setOpenMenuId(id);
  }, []);
  const openApplicationMenuAtEdge = useCallback((id: ApplicationMenuId, edge: 'first' | 'last') => {
    if (id !== 'edit') setEditThemeOpen(false);
    setMenuFocusEdge(edge);
    setOpenMenuId(id);
  }, []);
  const dismissApplicationMenu = useCallback((restoreFocus = false) => {
    setOpenMenuId((current) => {
      if (restoreFocus && current) triggerRefs.current.get(current)?.focus();
      return null;
    });
    setMenuFocusEdge(null);
    setEditThemeOpen(false);
  }, []);
  const moveTopLevel = useCallback(
    (from: ApplicationMenuId, step: -1 | 1, openNext = false) => {
      const currentIndex = menuOrder.indexOf(from);
      const nextId = menuOrder[(currentIndex + step + menuOrder.length) % menuOrder.length]!;
      triggerRefs.current.get(nextId)?.focus();
      if (openNext) openApplicationMenuAtEdge(nextId, 'first');
      else dismissApplicationMenu();
    },
    [dismissApplicationMenu, menuOrder, openApplicationMenuAtEdge],
  );
  const handleTriggerKeyDown = useCallback(
    (id: ApplicationMenuId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTopLevel(id, event.key === 'ArrowRight' ? 1 : -1, openMenuId !== null);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openApplicationMenuAtEdge(id, event.key === 'ArrowDown' ? 'first' : 'last');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openApplicationMenuAtEdge(id, 'first');
        return;
      }
      if (event.key === 'Escape' && openMenuId) {
        event.preventDefault();
        dismissApplicationMenu(true);
      }
    },
    [dismissApplicationMenu, moveTopLevel, openApplicationMenuAtEdge, openMenuId],
  );
  const handleMenuKeyDown = useCallback(
    (id: ApplicationMenuId, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = menuItems(id);
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(activeIndex + step + items.length) % items.length]?.focus();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTopLevel(id, event.key === 'ArrowRight' ? 1 : -1, true);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissApplicationMenu(true);
        return;
      }
      if (event.key === 'Tab') dismissApplicationMenu();
    },
    [dismissApplicationMenu, menuItems, moveTopLevel],
  );
  const handleThemeTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!['ArrowRight', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      openThemeSubmenu(true);
    },
    [openThemeSubmenu],
  );
  const handleThemeMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = themeMenuItems();
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(activeIndex + step + items.length) % items.length]?.focus();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setEditThemeOpen(false);
        requestAnimationFrame(() => themeTriggerRef.current?.focus());
        return;
      }
      if (event.key === 'Tab') dismissApplicationMenu();
    },
    [dismissApplicationMenu, themeMenuItems],
  );

  useEffect(() => () => cancelThemeSubmenuClose(), [cancelThemeSubmenuClose]);
  useEffect(() => {
    if (!openMenuId || !menuFocusEdge) return;
    const frame = requestAnimationFrame(() => {
      const items = menuItems(openMenuId);
      (menuFocusEdge === 'last' ? items.at(-1) : items[0])?.focus();
      setMenuFocusEdge(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [menuFocusEdge, menuItems, openMenuId]);
  useEffect(() => {
    if (!openMenuId) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-dropdown-menu]')) {
        dismissApplicationMenu();
      }
    };
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer);
  }, [dismissApplicationMenu, openMenuId]);
  useEffect(() => {
    const handleKeybinding = (event: KeyboardEvent) => {
      const action = actionForKeyboardEvent(event);
      if (!action) return;
      event.preventDefault();
      dismissApplicationMenu();
      dispatchAppAction(action);
    };
    window.addEventListener('keydown', handleKeybinding);
    return () => window.removeEventListener('keydown', handleKeybinding);
  }, [dismissApplicationMenu]);

  return {
    openMenuId,
    editThemeOpen,
    triggerRefs,
    popupRefs,
    themeTriggerRef,
    themePopupRef,
    openApplicationMenu,
    dismissApplicationMenu,
    handleTriggerKeyDown,
    handleMenuKeyDown,
    openThemeSubmenu,
    scheduleThemeSubmenuClose,
    cancelThemeSubmenuClose,
    handleThemeTriggerKeyDown,
    handleThemeMenuKeyDown,
  };
}

interface WorkspaceMastheadProps {
  workspaceId: string;
  currentProject?: ProjectSummary;
  projects?: ProjectSummary[];
  displayName?: string;
  theme: ThemeId;
  isFullscreen: boolean;
  navigate: (path: string) => void;
  chooseTheme: (theme: ThemeId) => void;
  toggleFullscreen: () => Promise<void>;
  logout: () => Promise<void>;
}

export function WorkspaceMasthead(props: WorkspaceMastheadProps) {
  const menu = useMenuController();
  const menuProps = (id: ApplicationMenuId) => ({
    id,
    open: menu.openMenuId === id,
    triggerRef: (element: HTMLButtonElement | null) =>
      element ? menu.triggerRefs.current.set(id, element) : menu.triggerRefs.current.delete(id),
    popupRef: (element: HTMLDivElement | null) =>
      element ? menu.popupRefs.current.set(id, element) : menu.popupRefs.current.delete(id),
    onToggle: () =>
      menu.openMenuId === id ? menu.dismissApplicationMenu() : menu.openApplicationMenu(id),
    onTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) =>
      menu.handleTriggerKeyDown(id, event),
    onMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => menu.handleMenuKeyDown(id, event),
  });
  const itemProps = { dismiss: menu.dismissApplicationMenu };

  return (
    <header className={styles.masthead}>
      <div className={styles.appMenus}>
        <button onClick={() => props.navigate('/')} className={styles.brand}>
          <span className={styles.logoMark} aria-hidden="true" />
          <span className={styles.visuallyHidden}>{messages.brand}</span>
        </button>
        <nav className={styles.menuBar} role="menubar" aria-label="Application menu">
          <ApplicationMenu {...menuProps('file')} label="File">
            <ApplicationMenuItem {...itemProps} onSelect={() => props.navigate('/')}>
              Projects
            </ApplicationMenuItem>
            <ApplicationMenuItem {...itemProps} onSelect={() => props.navigate('/projects/new')}>
              New project
            </ApplicationMenuItem>
            <DropdownMenuSeparator />
            <ApplicationMenuItem {...itemProps} onSelect={() => void props.logout()}>
              <span className={styles.menuItemWithIcon}>
                <SignOutIcon size={12} aria-hidden="true" /> Sign out
              </span>
            </ApplicationMenuItem>
          </ApplicationMenu>
          <ApplicationMenu {...menuProps('edit')} label="Edit">
            <ApplicationMenuItem
              {...itemProps}
              actionId="undoItem"
              onSelect={() => dispatchAppAction('undoItem')}
            >
              Undo item change
            </ApplicationMenuItem>
            <ApplicationMenuItem
              {...itemProps}
              actionId="redoItem"
              onSelect={() => dispatchAppAction('redoItem')}
            >
              Redo item change
            </ApplicationMenuItem>
            <DropdownMenuSeparator />
            <div
              className={styles.appSubmenu}
              data-app-submenu
              onPointerEnter={() => menu.openThemeSubmenu(false)}
              onPointerLeave={menu.scheduleThemeSubmenuClose}
            >
              <button
                ref={menu.themeTriggerRef}
                type="button"
                role="menuitem"
                className={styles.appSubmenuTrigger}
                aria-haspopup="menu"
                aria-expanded={menu.editThemeOpen}
                onClick={() => menu.openThemeSubmenu(true)}
                onKeyDown={menu.handleThemeTriggerKeyDown}
              >
                <span>Theme</span>
                <CaretRightIcon size={12} aria-hidden="true" />
              </button>
              {menu.editThemeOpen && (
                <div
                  ref={menu.themePopupRef}
                  role="menu"
                  aria-label="Theme"
                  className={styles.appSubmenuPopup}
                  onPointerEnter={menu.cancelThemeSubmenuClose}
                  onPointerLeave={menu.scheduleThemeSubmenuClose}
                  onKeyDown={menu.handleThemeMenuKeyDown}
                >
                  {themes.map((entry) => (
                    <DropdownMenuItem
                      key={entry.id}
                      dismiss={menu.dismissApplicationMenu}
                      ariaCurrent={entry.id === props.theme}
                      onSelect={() => props.chooseTheme(entry.id)}
                    >
                      <span className={styles.themeMenuOption}>
                        <span className={styles.themeMenuCheck} aria-hidden="true">
                          {entry.id === props.theme && <CheckIcon size={12} weight="bold" />}
                        </span>
                        <span>{entry.label}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </div>
          </ApplicationMenu>
          <ApplicationMenu {...menuProps('view')} label="View">
            {[
              ['zoomIn', 'Zoom in'],
              ['zoomOut', 'Zoom out'],
              ['zoomReset', 'Actual size'],
            ].map(([actionId, label]) => (
              <ApplicationMenuItem
                key={actionId}
                {...itemProps}
                actionId={actionId as AppActionId}
                dismissOnSelect={false}
                onSelect={() => dispatchAppAction(actionId as AppActionId)}
              >
                {label}
              </ApplicationMenuItem>
            ))}
            <DropdownMenuSeparator />
            {[
              ['textIncrease', 'Increase text size'],
              ['textDecrease', 'Decrease text size'],
              ['textReset', 'Reset text size'],
            ].map(([actionId, label]) => (
              <ApplicationMenuItem
                key={actionId}
                {...itemProps}
                dismissOnSelect={false}
                onSelect={() => dispatchAppAction(actionId as AppActionId)}
              >
                {label}
              </ApplicationMenuItem>
            ))}
            <DropdownMenuSeparator />
            <ApplicationMenuItem
              {...itemProps}
              shortcut="F11"
              onSelect={() => void props.toggleFullscreen()}
            >
              {props.isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
            </ApplicationMenuItem>
          </ApplicationMenu>
          <ApplicationMenu {...menuProps('workspace')} label="Workspace">
            <ApplicationMenuItem
              {...itemProps}
              onSelect={() => window.dispatchEvent(new CustomEvent('coda:reset-workspace'))}
            >
              Reset workspace
            </ApplicationMenuItem>
            <ApplicationMenuItem
              {...itemProps}
              onSelect={() => window.dispatchEvent(new CustomEvent('coda:publish-workspace'))}
            >
              Publish default
            </ApplicationMenuItem>
          </ApplicationMenu>
        </nav>
      </div>
      <div className={styles.mastheadEnd}>
        <ApplicationMenu
          {...menuProps('project')}
          className={styles.projectMenu}
          popupClassName={styles.projectMenuPopup}
          label={
            <>
              <FilmReelIcon size={12} aria-hidden="true" />
              <span>{props.currentProject?.name ?? 'Project'}</span>
              <CaretUpDownIcon className={styles.projectMenuCaret} size={12} aria-hidden="true" />
            </>
          }
        >
          <ApplicationMenuItem
            {...itemProps}
            onSelect={() => props.navigate(`/projects/${props.workspaceId}/manage`)}
          >
            Manage current project
          </ApplicationMenuItem>
          <DropdownMenuSeparator />
          {props.projects?.map((project) => (
            <ApplicationMenuItem
              key={project.id}
              {...itemProps}
              onSelect={() => props.navigate(`/projects/${project.id}`)}
            >
              {project.name}
            </ApplicationMenuItem>
          ))}
          <DropdownMenuSeparator />
          <span role="presentation" className={styles.accountName}>
            {props.displayName}
          </span>
          <ApplicationMenuItem {...itemProps} onSelect={() => props.navigate('/account')}>
            <span className={styles.menuItemWithIcon}>
              <UserCircleIcon size={12} aria-hidden="true" /> Account settings
            </span>
          </ApplicationMenuItem>
          <ApplicationMenuItem {...itemProps} onSelect={() => void props.logout()}>
            <span className={styles.menuItemWithIcon}>
              <SignOutIcon size={12} aria-hidden="true" /> Sign out
            </span>
          </ApplicationMenuItem>
        </ApplicationMenu>
      </div>
    </header>
  );
}

export function HomeMasthead({
  navigate,
  logout,
}: Pick<WorkspaceMastheadProps, 'navigate' | 'logout'>) {
  return (
    <header className={styles.homeMasthead}>
      <button onClick={() => navigate('/')} className={styles.homeBrand}>
        <span className={styles.logoMark} aria-hidden="true" />
        <span className={styles.visuallyHidden}>{messages.brand}</span>
      </button>
      <div className={styles.homeAccount}>
        <button type="button" onClick={() => void logout()}>
          <SignOutIcon size={12} aria-hidden="true" /> Sign out
        </button>
      </div>
    </header>
  );
}

export function WorkspaceRouteLoadingSkeleton() {
  return (
    <div className={`${styles.shell} ${styles.editorShell}`} aria-busy="true">
      <header className={styles.masthead}>
        <div className={styles.appMenus}>
          <Skeleton width={50} height={18} radius={2} />
          <Skeleton width={188} height={12} />
        </div>
        <Skeleton width={190} height={28} radius={4} />
      </header>
      <WorkspaceLoadingSkeleton />
    </div>
  );
}
