import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CornersInIcon } from '@phosphor-icons/react/dist/csr/CornersIn';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { FilmSlateIcon } from '@phosphor-icons/react/dist/csr/FilmSlate';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { RowsIcon } from '@phosphor-icons/react/dist/csr/Rows';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import type { WorkspacePanelSlot } from '@coda/contracts';
import dropdownStyles from '../../components/DropdownMenu.module.css';
import { Tooltip } from '../../components/Tooltip';
import type { LayoutDirection } from '../layout';
import type { PanelFrameActions, WorkspaceShellProps } from './types';
import styles from './WorkspaceShell.module.css';

const directions: readonly LayoutDirection[] = ['left', 'right', 'up', 'down'];

function panelTitle(slot: WorkspacePanelSlot): string {
  if (slot.panel.type === 'entity_table') return 'Entity table';
  if (slot.panel.type === 'inspector') return 'Inspector';
  if (slot.panel.type === 'pdf') return 'PDF Viewer';
  if (slot.panel.type === 'activity') return 'Activity';
  return 'Trash';
}

function panelMenuName(slot: WorkspacePanelSlot): string {
  return slot.panel.type === 'pdf' ? 'PDF source' : panelTitle(slot);
}

const panelIcons = {
  entity_table: FilmSlateIcon,
  inspector: TagSimpleIcon,
  pdf: FilesIcon,
  activity: ClockCounterClockwiseIcon,
  trash: TrashIcon,
} as const;

function MenuItem({
  label,
  icon,
  disabled,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={dropdownStyles.item}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={styles.menuItemContent}>
        {icon && <span className={styles.menuItemIcon}>{icon}</span>}
        <span>{label}</span>
      </span>
    </button>
  );
}

export function PanelFrame({
  slot,
  active,
  fullscreen,
  actions,
  onActivate,
  toolbar,
  commands,
  menuItems,
  children,
}: {
  slot: WorkspacePanelSlot;
  active: boolean;
  fullscreen: boolean;
  actions: PanelFrameActions;
  onActivate: () => void;
  toolbar?: WorkspaceShellProps['renderPanelToolbar'];
  commands?: WorkspaceShellProps['renderPanelCommands'];
  menuItems?: WorkspaceShellProps['renderPanelMenuItems'];
  children: ReactNode;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const closeMenu = (restoreFocus = false) => {
    setMenuPosition(undefined);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenuAt = (x: number, y: number) => {
    const width = 224;
    const height = 438;
    setMenuPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  };
  const toggleMenuFrom = (element: HTMLElement | null) => {
    if (menuPosition) closeMenu();
    else if (element) {
      const bounds = element.getBoundingClientRect();
      openMenuAt(bounds.right - 224, bounds.bottom + 2);
    }
  };

  useEffect(() => {
    if (!menuPosition) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnKey);
    requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const bounds = menu.getBoundingClientRect();
      setMenuPosition(
        (current) =>
          current && {
            x: Math.max(4, Math.min(current.x, window.innerWidth - bounds.width - 4)),
            y: Math.max(4, Math.min(current.y, window.innerHeight - bounds.height - 4)),
          },
      );
      menu.querySelector<HTMLButtonElement>('button')?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [menuPosition]);

  const select = (operation: () => void) => {
    closeMenu();
    operation();
  };

  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    onActivate();
    openMenuAt(event.clientX, event.clientY);
  };
  const PanelIcon = panelIcons[slot.panel.type];
  const renderContext = {
    slot,
    slotId: slot.id,
    panel: slot.panel,
    isActive: active,
    isFullscreen: fullscreen,
  };
  const contextualMenuItems = menuItems?.(renderContext) ?? [];

  return (
    <section
      className={`${styles.panelFrame} ${active ? styles.activePanel : ''} ${fullscreen ? styles.fullscreenPanel : ''}`}
      data-panel-id={slot.panel.id}
      tabIndex={-1}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      onContextMenu={contextMenu}
    >
      <header ref={headerRef} className={styles.panelHeader}>
        {toolbar ? (
          <div className={styles.panelToolbarContribution}>
            {toolbar({ ...renderContext, openPanelMenu: () => toggleMenuFrom(headerRef.current) })}
          </div>
        ) : (
          <Tooltip content="Choose which content this workspace panel displays">
            <button
              type="button"
              className={styles.panelPickerButton}
              aria-label={`Open ${panelMenuName(slot)} panel menu`}
              aria-haspopup="menu"
              aria-expanded={Boolean(menuPosition)}
              onClick={(event) => toggleMenuFrom(event.currentTarget)}
            >
              <PanelIcon size={12} aria-hidden="true" />
              <span className={styles.panelTitle}>{panelTitle(slot)}</span>
            </button>
          </Tooltip>
        )}
        {(commands || !toolbar) && (
          <nav className={styles.panelCommands} aria-label={`${panelTitle(slot)} commands`}>
            {commands ? (
              commands(renderContext)
            ) : (
              <>
                <button type="button">View</button>
                <button type="button">Select</button>
                <button type="button">Add</button>
              </>
            )}
          </nav>
        )}
        {!toolbar && <span className={styles.panelHeaderSpacer} />}
        <Tooltip
          content={
            fullscreen
              ? 'Return this panel to the multi-panel workspace'
              : 'Expand this panel to fill the workspace'
          }
        >
          <button
            type="button"
            className={styles.iconButton}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={actions.onToggleFullscreen}
          >
            {fullscreen ? (
              <CornersInIcon size={12} aria-hidden="true" />
            ) : (
              <CornersOutIcon size={12} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
        {!toolbar && (
          <Tooltip content="Open layout actions for this workspace panel">
            <button
              ref={triggerRef}
              type="button"
              className={styles.iconButton}
              aria-label="Panel operations"
              onClick={(event) => toggleMenuFrom(event.currentTarget)}
            >
              <DotsThreeIcon size={12} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </header>
      <div className={styles.panelBody}>{children}</div>
      {menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.contextMenu}`}
            role="menu"
            aria-label={`${panelTitle(slot)} panel actions`}
            style={{ left: menuPosition.x, top: menuPosition.y }}
          >
            {contextualMenuItems.map((item) => (
              <MenuItem
                key={item.label}
                label={item.label}
                disabled={item.disabled}
                onSelect={() => select(item.action)}
              />
            ))}
            {contextualMenuItems.length > 0 && (
              <span role="separator" className={dropdownStyles.separator} />
            )}
            <div className={styles.menuLabel}>Split</div>
            <MenuItem
              label="Split left / right"
              icon={<ColumnsIcon size={12} weight="bold" aria-hidden="true" />}
              disabled={!actions.canSplit}
              onSelect={() => select(() => actions.onSplit('horizontal'))}
            />
            <MenuItem
              label="Split top / bottom"
              icon={<RowsIcon size={12} weight="bold" aria-hidden="true" />}
              disabled={!actions.canSplit}
              onSelect={() => select(() => actions.onSplit('vertical'))}
            />
            <span role="separator" className={dropdownStyles.separator} />
            <div className={styles.menuLabel}>Join</div>
            {directions.map((direction) => {
              return (
                <MenuItem
                  key={`join-${direction}`}
                  label={`Join ${direction}`}
                  disabled={!actions.canJoin[direction]}
                  onSelect={() => select(() => actions.onJoin(direction))}
                />
              );
            })}
            <span role="separator" className={dropdownStyles.separator} />
            <div className={styles.menuLabel}>Swap</div>
            {directions.map((direction) => {
              return (
                <MenuItem
                  key={`swap-${direction}`}
                  label={`Swap ${direction}`}
                  disabled={!actions.canSwap[direction]}
                  onSelect={() => select(() => actions.onSwap(direction))}
                />
              );
            })}
            <span role="separator" className={dropdownStyles.separator} />
            <MenuItem
              label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              icon={
                fullscreen ? (
                  <CornersInIcon size={12} aria-hidden="true" />
                ) : (
                  <CornersOutIcon size={12} aria-hidden="true" />
                )
              }
              onSelect={() => select(actions.onToggleFullscreen)}
            />
            <span role="separator" className={dropdownStyles.separator} />
            <MenuItem
              label="Close panel"
              icon={<XIcon size={12} weight="bold" aria-hidden="true" />}
              disabled={!actions.canClose}
              onSelect={() => select(actions.onClose)}
            />
          </div>,
          document.body,
        )}
    </section>
  );
}
