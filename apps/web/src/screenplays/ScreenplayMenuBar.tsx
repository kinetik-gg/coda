import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  type DropdownMenuProps,
} from '../components/DropdownMenu';
import appStyles from '../App.styles';
import type { ScreenplayCommandId, ScreenplayCommandState } from './screenplay-commands';
import type { FountainFormatCommand } from './screenplay-formatting';
import type { ScreenplayPaperSize } from './screenplay-paper';
import styles from './ScreenplayMenuBar.module.css';

type MenuId = 'file' | 'edit' | 'format' | 'view' | 'tools';
type SubmenuId = 'export' | 'paper-size';

const appMenuOrder: readonly MenuId[] = ['file', 'edit', 'format', 'view', 'tools'];

function shortcut(value: string): string {
  return value.replace('Mod', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
}

function MenuItem({
  children,
  onSelect,
  dismiss,
  shortcut: keybinding,
  checked,
}: {
  children: ReactNode;
  onSelect: () => void;
  dismiss: () => void;
  shortcut?: string;
  checked?: boolean;
}) {
  return (
    <DropdownMenuItem
      dismiss={dismiss}
      shortcut={keybinding ? shortcut(keybinding) : undefined}
      checked={checked}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuItem>
  );
}

export interface ScreenplayMenuBarProps {
  title: string;
  filename: string;
  commandState: Readonly<ScreenplayCommandState>;
  paperSize: ScreenplayPaperSize;
  onBack: () => void;
  onSave: () => void;
  onDownload: () => void;
  onExportPdf: () => void;
  onExportFinalDraft: () => void;
  onCommand: (command: ScreenplayCommandId) => void;
  onFormat: (command: FountainFormatCommand) => void;
  onToggleZen: () => void;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
  showPageBreaks: boolean;
  onTogglePageBreaks: () => void;
  onPaperSizeChange: (paperSize: ScreenplayPaperSize) => void;
  onResetLayout: () => void;
}

function Submenu({
  id,
  label,
  open,
  onOpen,
  onClose,
  children,
}: {
  id: SubmenuId;
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const focusFirst = () =>
    requestAnimationFrame(() =>
      popupRef.current?.querySelector<HTMLButtonElement>('button')?.focus(),
    );
  return (
    <div className={appStyles.appSubmenu} data-app-submenu={id} onPointerEnter={onOpen}>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        className={appStyles.appSubmenuTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          onOpen();
          focusFirst();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'Enter') return;
          event.preventDefault();
          onOpen();
          focusFirst();
        }}
      >
        <span>{label}</span>
        <CaretRightIcon size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={popupRef}
          role="menu"
          aria-label={label}
          className={appStyles.appSubmenuPopup}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return;
            event.preventDefault();
            onClose();
            triggerRef.current?.focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ScreenplayMenus({
  props,
  dismiss,
  menuProps,
  openSubmenu,
  setOpenSubmenu,
  visibleMenus,
}: {
  props: ScreenplayMenuBarProps;
  dismiss: () => void;
  menuProps: (id: MenuId) => Omit<DropdownMenuProps, 'children' | 'label'>;
  openSubmenu: SubmenuId | null;
  setOpenSubmenu: (id: SubmenuId | null) => void;
  visibleMenus: readonly MenuId[];
}) {
  const command = (id: ScreenplayCommandId) => () => props.onCommand(id);
  const format = (id: FountainFormatCommand) => () => props.onFormat(id);
  return (
    <>
      {visibleMenus.includes('file') && <DropdownMenu {...menuProps('file')} label="File">
        <MenuItem dismiss={dismiss} onSelect={props.onBack}>
          Screenplays
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem dismiss={dismiss} shortcut="Mod-S" onSelect={props.onSave}>
          Save
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Shift-S" onSelect={props.onDownload}>
          Save Fountain Copy…
        </MenuItem>
        <DropdownMenuSeparator />
        <Submenu
          id="export"
          label="Export"
          open={openSubmenu === 'export'}
          onOpen={() => setOpenSubmenu('export')}
          onClose={() => setOpenSubmenu(null)}
        >
          <MenuItem dismiss={dismiss} shortcut="Mod-P" onSelect={props.onExportPdf}>
            PDF…
          </MenuItem>
          <MenuItem dismiss={dismiss} onSelect={props.onExportFinalDraft}>
            Final Draft (.fdx)…
          </MenuItem>
        </Submenu>
        <Submenu
          id="paper-size"
          label="Paper Size"
          open={openSubmenu === 'paper-size'}
          onOpen={() => setOpenSubmenu('paper-size')}
          onClose={() => setOpenSubmenu(null)}
        >
          <MenuItem
            dismiss={dismiss}
            checked={props.paperSize === 'letter'}
            onSelect={() => props.onPaperSizeChange('letter')}
          >
            US Letter (8.5 × 11 in)
          </MenuItem>
          <MenuItem
            dismiss={dismiss}
            checked={props.paperSize === 'a4'}
            onSelect={() => props.onPaperSizeChange('a4')}
          >
            A4 (210 × 297 mm)
          </MenuItem>
        </Submenu>
      </DropdownMenu>}
      {visibleMenus.includes('edit') && <DropdownMenu {...menuProps('edit')} label="Edit">
        <MenuItem dismiss={dismiss} shortcut="Mod-Z" onSelect={command('undo')}>
          Undo
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Shift-Z" onSelect={command('redo')}>
          Redo
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem dismiss={dismiss} shortcut="Mod-X" onSelect={command('cut')}>
          Cut
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-C" onSelect={command('copy')}>
          Copy
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-V" onSelect={command('paste')}>
          Paste
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-A" onSelect={command('select-all')}>
          Select All
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem dismiss={dismiss} shortcut="Mod-F" onSelect={command('open-find')}>
          Find…
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Alt-F" onSelect={command('open-replace')}>
          Find and Replace…
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-G" onSelect={command('find-next')}>
          Find Next
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Shift-G" onSelect={command('find-previous')}>
          Find Previous
        </MenuItem>
      </DropdownMenu>}
      {visibleMenus.includes('format') && <DropdownMenu {...menuProps('format')} label="Format">
        <MenuItem dismiss={dismiss} shortcut="Mod-B" onSelect={format('bold')}>
          Bold
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-I" onSelect={format('italic')}>
          Italic
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-U" onSelect={format('underline')}>
          Underline
        </MenuItem>
        <DropdownMenuSeparator />
        {(
          [
            ['scene-heading', 'Scene Heading'],
            ['action', 'Action'],
            ['character', 'Character'],
            ['parenthetical', 'Parenthetical'],
            ['transition', 'Transition'],
            ['lyric', 'Lyric'],
            ['centered', 'Centered'],
            ['note', 'Note'],
            ['page-break', 'Page Break'],
          ] as const
        ).map(([id, label]) => (
          <MenuItem key={id} dismiss={dismiss} onSelect={format(id)}>
            {label}
          </MenuItem>
        ))}
      </DropdownMenu>}
      {visibleMenus.includes('view') && <DropdownMenu {...menuProps('view')} label="View">
        <MenuItem dismiss={dismiss} shortcut="Mod-Plus" onSelect={command('zoom-in')}>
          Zoom In
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Minus" onSelect={command('zoom-out')}>
          Zoom Out
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-0" onSelect={command('zoom-reset')}>
          Actual Size
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem dismiss={dismiss} onSelect={command('font-size-increase')}>
          Increase Editor Font
        </MenuItem>
        <MenuItem dismiss={dismiss} onSelect={command('font-size-decrease')}>
          Decrease Editor Font
        </MenuItem>
        <MenuItem dismiss={dismiss} onSelect={command('font-size-reset')}>
          Reset Editor Font
        </MenuItem>
        <MenuItem
          dismiss={dismiss}
          checked={props.showLineNumbers}
          onSelect={props.onToggleLineNumbers}
        >
          Line Numbers
        </MenuItem>
        <MenuItem
          dismiss={dismiss}
          checked={props.showPageBreaks}
          onSelect={props.onTogglePageBreaks}
        >
          Estimated Page Breaks
        </MenuItem>
        <MenuItem dismiss={dismiss} shortcut="Mod-Shift-Enter" onSelect={props.onToggleZen}>
          Zen Mode
        </MenuItem>
        <DropdownMenuSeparator />
        <MenuItem dismiss={dismiss} onSelect={props.onResetLayout}>
          Reset Workspace Layout
        </MenuItem>
      </DropdownMenu>}
      {visibleMenus.includes('tools') && <DropdownMenu {...menuProps('tools')} label="Tools">
        <MenuItem
          dismiss={dismiss}
          checked={props.commandState.grammarCheckEnabled}
          onSelect={command('toggle-grammar-check')}
        >
          Check Spelling and Grammar
        </MenuItem>
      </DropdownMenu>}
    </>
  );
}

function useScreenplayMenuController(menuOrder: readonly MenuId[]) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<SubmenuId | null>(null);
  const triggers = useRef(new Map<MenuId, HTMLButtonElement>());
  const popups = useRef(new Map<MenuId, HTMLDivElement>());
  const dismiss = useCallback(() => {
    setOpenSubmenu(null);
    setOpenMenu(null);
  }, []);
  const items = useCallback((id: MenuId) => {
    const popup = popups.current.get(id);
    return popup
      ? Array.from(popup.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
      : [];
  }, []);
  const moveMenu = useCallback(
    (id: MenuId, step: -1 | 1) => {
      const index = menuOrder.indexOf(id);
      const next = menuOrder[(index + step + menuOrder.length) % menuOrder.length]!;
      triggers.current.get(next)?.focus();
      setOpenSubmenu(null);
      setOpenMenu((current) => (current ? next : current));
    },
    [menuOrder],
  );
  const triggerKeyDown = (id: MenuId, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveMenu(id, event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpenMenu(id);
      requestAnimationFrame(() => {
        const entries = items(id);
        (event.key === 'ArrowDown' ? entries[0] : entries.at(-1))?.focus();
      });
    }
  };
  const popupKeyDown = (id: MenuId, event: KeyboardEvent<HTMLDivElement>) => {
    const entries = items(id);
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      entries[(current + step + entries.length) % entries.length]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveMenu(id, event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      triggers.current.get(id)?.focus();
    }
  };
  const menuProps = (id: MenuId) => ({
    id: `screenplay-${id}`,
    open: openMenu === id,
    className: appStyles.appMenu,
    triggerClassName: appStyles.menuTrigger,
    popupClassName: `${appStyles.appMenuPopup} ${styles.menuPopup}`,
    rootRole: 'none' as const,
    triggerRole: 'menuitem' as const,
    triggerRef: (element: HTMLButtonElement | null) => {
      if (element) triggers.current.set(id, element);
      else triggers.current.delete(id);
    },
    popupRef: (element: HTMLDivElement | null) => {
      if (element) popups.current.set(id, element);
      else popups.current.delete(id);
    },
    onToggle: () => {
      setOpenSubmenu(null);
      setOpenMenu((current) => (current === id ? null : id));
    },
    onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => triggerKeyDown(id, event),
    onMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => popupKeyDown(id, event),
  });

  useEffect(() => {
    if (!openMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-dropdown-menu]')) {
        dismiss();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [dismiss, openMenu]);

  return { dismiss, menuProps, openSubmenu, setOpenSubmenu };
}

export function ScreenplayMenuBar(props: ScreenplayMenuBarProps) {
  const controller = useScreenplayMenuController(appMenuOrder);

  return (
    <header className={styles.masthead}>
      <div className={appStyles.appMenus}>
        <button type="button" onClick={props.onBack} className={appStyles.brand}>
          <span className={appStyles.logoMark} aria-hidden="true" />
          <span className={appStyles.visuallyHidden}>Back to screenplays</span>
        </button>
        <nav className={appStyles.menuBar} role="menubar" aria-label="Screenplay application menu">
          <ScreenplayMenus
            props={props}
            dismiss={controller.dismiss}
            menuProps={controller.menuProps}
            openSubmenu={controller.openSubmenu}
            setOpenSubmenu={controller.setOpenSubmenu}
            visibleMenus={appMenuOrder}
          />
        </nav>
      </div>
      <div className={styles.documentIdentity} title={`${props.title} · ${props.filename}`}>
        <BookOpenTextIcon size={13} aria-hidden="true" />
        <span>{props.title}</span>
        <small>{props.filename}</small>
        <CaretUpDownIcon size={12} aria-hidden="true" />
      </div>
    </header>
  );
}
