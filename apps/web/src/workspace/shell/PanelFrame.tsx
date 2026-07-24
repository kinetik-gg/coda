import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CornersInIcon } from '@phosphor-icons/react/dist/csr/CornersIn';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { RowsIcon } from '@phosphor-icons/react/dist/csr/Rows';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import dropdownStyles from '../../components/DropdownMenu.module.css';
import { Tooltip } from '../../components/Tooltip';
import type { LayoutDirection, PanelLayoutSlot } from '../layout';
import { dispatchPanelAction } from './panel-actions';
import type {
  PanelFrameActions,
  ShellPanel,
  WorkspacePanelControlsContext,
  WorkspacePanelMenuItem,
  WorkspacePanelRegistry,
} from './types';
import styles from './WorkspaceShell.module.css';

const directions: readonly LayoutDirection[] = ['left', 'right', 'up', 'down'];

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

function PanelPicker<TPanel extends ShellPanel, TControls = void>({
  slot,
  registry,
  onReplace,
}: {
  slot: PanelLayoutSlot<TPanel>;
  registry: WorkspacePanelRegistry<TPanel, TControls>;
  onReplace: (panel: TPanel) => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const title = registry.title(slot.panel);
  const current = registry.definitions.find((definition) => definition.type === slot.panel.type);

  useEffect(() => {
    if (!position) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setPosition(undefined);
      }
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPosition(undefined);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [position]);

  const toggle = () => {
    if (position) {
      setPosition(undefined);
      return;
    }
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      x: Math.max(4, Math.min(bounds.left, window.innerWidth - 224)),
      y: Math.max(4, Math.min(bounds.bottom + 2, window.innerHeight - 240)),
    });
  };

  return (
    <>
      <Tooltip content="Choose which content this workspace panel displays">
        <button
          ref={triggerRef}
          type="button"
          className={styles.panelPickerButton}
          aria-label={`Choose ${title} panel function`}
          aria-haspopup="menu"
          aria-expanded={Boolean(position)}
          onClick={toggle}
        >
          {current?.icon}
          <span className={styles.panelTitle}>{title}</span>
          <CaretUpDownIcon className={styles.panelPickerCaret} size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Choose panel function"
            className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.panelPickerMenu}`}
            style={{ left: position.x, top: position.y }}
          >
            {registry.definitions.map((definition) => {
              const selected = definition.type === slot.panel.type;
              return (
                <button
                  key={definition.type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={dropdownStyles.item}
                  onClick={() => {
                    setPosition(undefined);
                    if (!selected) {
                      onReplace(definition.createPanel(slot.panel.id, slot.panel));
                    }
                  }}
                >
                  <span className={styles.menuItemContent}>
                    <span className={styles.menuItemIcon}>{definition.icon}</span>
                    <span>{definition.label}</span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

function PanelOperationsMenu<TPanel extends ShellPanel, TControls = void>({
  slot,
  registry,
  fullscreen,
  position,
  menuRef,
  actions,
  contextualItems,
  onSelect,
}: {
  slot: PanelLayoutSlot<TPanel>;
  registry: WorkspacePanelRegistry<TPanel, TControls>;
  fullscreen: boolean;
  position: { x: number; y: number };
  menuRef: RefObject<HTMLDivElement | null>;
  actions: PanelFrameActions<TPanel>;
  contextualItems: WorkspacePanelMenuItem[];
  onSelect: (operation: () => void) => void;
}) {
  return createPortal(
    <div
      ref={menuRef}
      className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.contextMenu}`}
      role="menu"
      aria-label={`${registry.title(slot.panel)} panel actions`}
      style={{ left: position.x, top: position.y }}
    >
      {contextualItems.map((item) => (
        <MenuItem
          key={item.label}
          label={item.label}
          disabled={item.disabled}
          onSelect={() => onSelect(item.action)}
        />
      ))}
      {contextualItems.length > 0 && <span role="separator" className={dropdownStyles.separator} />}
      <div className={styles.menuLabel}>Split</div>
      <MenuItem
        label="Split left / right"
        icon={<ColumnsIcon size={12} weight="bold" aria-hidden="true" />}
        disabled={!actions.canSplit}
        onSelect={() => onSelect(() => actions.onSplit('horizontal'))}
      />
      <MenuItem
        label="Split top / bottom"
        icon={<RowsIcon size={12} weight="bold" aria-hidden="true" />}
        disabled={!actions.canSplit}
        onSelect={() => onSelect(() => actions.onSplit('vertical'))}
      />
      <span role="separator" className={dropdownStyles.separator} />
      <div className={styles.menuLabel}>Join</div>
      {directions.map((direction) => (
        <MenuItem
          key={`join-${direction}`}
          label={`Join ${direction}`}
          disabled={!actions.canJoin[direction]}
          onSelect={() => onSelect(() => actions.onJoin(direction))}
        />
      ))}
      <span role="separator" className={dropdownStyles.separator} />
      <div className={styles.menuLabel}>Swap</div>
      {directions.map((direction) => (
        <MenuItem
          key={`swap-${direction}`}
          label={`Swap ${direction}`}
          disabled={!actions.canSwap[direction]}
          onSelect={() => onSelect(() => actions.onSwap(direction))}
        />
      ))}
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
        onSelect={() => onSelect(actions.onToggleFullscreen)}
      />
      <span role="separator" className={dropdownStyles.separator} />
      <MenuItem
        label="Close panel"
        icon={<XIcon size={12} weight="bold" aria-hidden="true" />}
        disabled={!actions.canClose}
        onSelect={() => onSelect(actions.onClose)}
      />
    </div>,
    document.body,
  );
}

export function PanelFrame<TPanel extends ShellPanel, TControls = void>({
  slot,
  panelRegistry,
  active,
  fullscreen,
  concealed = false,
  actions,
  onActivate,
  controlsContext,
  children,
}: {
  slot: PanelLayoutSlot<TPanel>;
  panelRegistry: WorkspacePanelRegistry<TPanel, TControls>;
  active: boolean;
  fullscreen: boolean;
  concealed?: boolean;
  actions: PanelFrameActions<TPanel>;
  onActivate: () => void;
  controlsContext?: TControls;
  children: ReactNode;
}) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => setMenuPosition(undefined);

  const openMenuAt = (x: number, y: number) => {
    const width = 224;
    const height = 438;
    setMenuPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  };

  useEffect(() => {
    if (!menuPosition) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
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
  const title = panelRegistry.title(slot.panel);
  const definition = panelRegistry.definitions.find(
    (candidate) => candidate.type === slot.panel.type,
  );
  const panelPicker = (
    <PanelPicker slot={slot} registry={panelRegistry} onReplace={actions.onReplace} />
  );
  const controlsCtx: WorkspacePanelControlsContext<TPanel, TControls> | undefined =
    controlsContext === undefined
      ? undefined
      : {
          slot,
          slotId: slot.id,
          panel: slot.panel,
          isActive: active,
          isFullscreen: fullscreen,
          controls: controlsContext,
          panelPicker,
          dispatchAction: (action) => dispatchPanelAction(slot.panel.id, action),
        };
  const toolbar = controlsCtx ? definition?.controls?.(controlsCtx) : undefined;
  const renderedCommands = controlsCtx ? definition?.commands?.(controlsCtx) : undefined;
  const contextualMenuItems = controlsCtx ? (definition?.menuItems?.(controlsCtx) ?? []) : [];

  return (
    <section
      className={`${styles.panelFrame} ${active ? styles.activePanel : ''} ${fullscreen ? styles.fullscreenPanel : ''}`}
      aria-label={title}
      data-panel-id={slot.panel.id}
      hidden={concealed}
      tabIndex={-1}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      onContextMenu={contextMenu}
    >
      <header className={styles.panelHeader}>
        {toolbar ? <div className={styles.panelToolbarContribution}>{toolbar}</div> : panelPicker}
        {renderedCommands && (
          <nav className={styles.panelCommands} aria-label={`${title} commands`}>
            {renderedCommands}
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
      </header>
      <div className={styles.panelBody}>{children}</div>
      {menuPosition && (
        <PanelOperationsMenu
          slot={slot}
          registry={panelRegistry}
          fullscreen={fullscreen}
          position={menuPosition}
          menuRef={menuRef}
          actions={actions}
          contextualItems={contextualMenuItems}
          onSelect={select}
        />
      )}
    </section>
  );
}
