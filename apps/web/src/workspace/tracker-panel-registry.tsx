import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { GridFourIcon } from '@phosphor-icons/react/dist/csr/GridFour';
import { KanbanIcon } from '@phosphor-icons/react/dist/csr/Kanban';
import { TableIcon } from '@phosphor-icons/react/dist/csr/Table';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import type { WorkspacePanel, WorkspacePanelSlot } from '@coda/contracts';
import { DropdownMenu, DropdownMenuItem } from '../components/DropdownMenu';
import { PanelCommandMenu, type PanelCommandItem } from './PanelCommandMenu';
import type { TrackerCurrentUser, TrackerField, TrackerRecord } from '../trackers/types';
import { ActivityPanel } from './panels/ActivityPanel';
import { freshBoardConfig, type BoardPanel } from './tracker-board/board-model';
import {
  freshGridConfig,
  isSingleSelectField,
  TRACKER_SORTS,
  type GridPanel,
} from './tracker-model';
import { freshMatrixConfig, type MatrixPanel } from './tracker-board/matrix-model';
import { TrackerGridPanel } from './tracker-grid/TrackerGridPanel';
import { TrackerGridHeaderControls } from './tracker-grid/TrackerGridHeaderControls';
import { TrackerInspectorPanel } from './tracker-grid/TrackerInspectorPanel';
import styles from './DenseWorkspace.module.css';
import type {
  WorkspacePanelControlsContext,
  WorkspacePanelRegistry,
} from './shell/types';

const TrackerBoardPanel = lazy(() =>
  import('./tracker-board/TrackerBoardPanel').then((module) => ({
    default: module.TrackerBoardPanel,
  })),
);
const TrackerMatrixPanel = lazy(() =>
  import('./tracker-board/TrackerMatrixPanel').then((module) => ({
    default: module.TrackerMatrixPanel,
  })),
);

/** Services the tracker editor threads to its registry-declared panel controls. */
export interface TrackerControlsContext {
  trackerId: string;
  canEditRecords: boolean;
  fields: TrackerField[];
  selectedRecord?: TrackerRecord;
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
}
type TrackerControls = WorkspacePanelControlsContext<WorkspacePanel, TrackerControlsContext>;

type TrackerPanelType = 'grid' | 'board' | 'matrix' | 'inspector' | 'activity';

const PANEL_LABELS: Record<TrackerPanelType, string> = {
  grid: 'Records',
  board: 'Board',
  matrix: 'Matrix',
  inspector: 'Inspector',
  activity: 'Activity',
};

function createPanel(type: TrackerPanelType, panelId: string): WorkspacePanel {
  if (type === 'grid')
    return {
      id: panelId,
      type,
      configVersion: 1,
      config: freshGridConfig(),
    };
  if (type === 'board')
    return {
      id: panelId,
      type,
      configVersion: 1,
      config: freshBoardConfig(),
    };
  if (type === 'matrix')
    return {
      id: panelId,
      type,
      configVersion: 1,
      config: freshMatrixConfig(),
    };
  if (type === 'inspector')
    return { id: panelId, type, configVersion: 1, config: { section: 'details', search: '' } };
  return { id: panelId, type, configVersion: 1, config: { search: '' } };
}

function title(panel: WorkspacePanel): string {
  if (panel.type === 'grid') return 'Records';
  if (panel.type === 'board') return 'Board';
  if (panel.type === 'matrix') return 'Matrix';
  if (panel.type === 'inspector') return 'Inspector';
  if (panel.type === 'activity') return 'Activity';
  return 'Panel';
}

function TrackerPanelPicker({
  slot,
  controls,
}: {
  slot: WorkspacePanelSlot;
  controls: TrackerControlsContext;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (rootRef.current?.contains(target as Node)) return;
      if (target instanceof Element && target.closest(`[data-dropdown-menu="panel-${slot.id}"]`))
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, slot.id]);

  const label = title(slot.panel);
  return (
    <div ref={rootRef} className={styles.panelSelector}>
      <DropdownMenu
        portal
        id={`panel-${slot.id}`}
        ariaLabel={label}
        label={
          <>
            <span className={styles.panelPickerIcon}>
              <TableIcon size={12} aria-hidden="true" />
            </span>
            <span className={styles.panelPickerLabel}>{label}</span>
            <CaretUpDownIcon className={styles.panelPickerCaret} size={12} aria-hidden="true" />
          </>
        }
        open={open}
        triggerClassName={styles.editorPicker}
        popupClassName={styles.panelSelectorPopup}
        onToggle={() => setOpen((value) => !value)}
      >
        {(['grid', 'board', 'matrix', 'inspector', 'activity'] as const).map((type) => (
          <DropdownMenuItem
            key={type}
            dismiss={() => setOpen(false)}
            ariaCurrent={slot.panel.type === type}
            onSelect={() =>
              slot.panel.type !== type &&
              controls.updatePanel(slot, createPanel(type, slot.panel.id))
            }
          >
            <span className={styles.panelPickerOption}>
              <span>{PANEL_LABELS[type]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}

/** One header dropdown of panel commands; every tracker panel contributes at most a few. */
interface PanelCommandGroup {
  label: string;
  items: PanelCommandItem[];
}

function gridCommands(
  slot: WorkspacePanelSlot,
  { updatePanel }: TrackerControlsContext,
  dispatchAction: (action: string) => void,
): PanelCommandItem[] | undefined {
  if (slot.panel.type !== 'grid') return undefined;
  const gridPanel = slot.panel as GridPanel;
  const update = (changes: Partial<GridPanel['config']>) =>
    updatePanel(slot, { ...gridPanel, config: { ...gridPanel.config, ...changes } });
  const sortLabels: Record<(typeof TRACKER_SORTS)[number], string> = {
    manual: 'Manual order',
    title: 'Sort by title',
    created_at: 'Sort by created',
    updated_at: 'Sort by updated',
  };
  return [
    { label: 'Refresh rows', action: () => dispatchAction('refresh') },
    ...TRACKER_SORTS.map((sort) => ({
      label: sortLabels[sort],
      checked: gridPanel.config.sort === sort,
      separatorBefore: sort === 'manual',
      action: () => update({ sort }),
    })),
    {
      label: 'Ascending',
      checked: gridPanel.config.direction === 'asc',
      separatorBefore: true,
      action: () => update({ direction: 'asc' }),
    },
    {
      label: 'Descending',
      checked: gridPanel.config.direction === 'desc',
      action: () => update({ direction: 'desc' }),
    },
  ];
}

function inspectorCommands(
  slot: WorkspacePanelSlot,
  { updatePanel }: TrackerControlsContext,
): PanelCommandItem[] | undefined {
  if (slot.panel.type !== 'inspector') return undefined;
  const inspectorPanel = slot.panel;
  const section = (next: 'details' | 'comments' | 'activity') =>
    updatePanel(slot, { ...inspectorPanel, config: { ...inspectorPanel.config, section: next } });
  return [
    {
      label: 'Details',
      checked: inspectorPanel.config.section === 'details',
      action: () => section('details'),
    },
    {
      label: 'Comments',
      checked: inspectorPanel.config.section === 'comments',
      action: () => section('comments'),
    },
    {
      label: 'Activity',
      checked: inspectorPanel.config.section === 'activity',
      action: () => section('activity'),
    },
  ];
}

const NOT_SINGLE_SELECT = 'Single-select fields only';

/** Radio list of single-select enum fields for one board/matrix picker, others disabled. */
function singleSelectChoices(
  fields: TrackerField[],
  activeId: string,
  onPick: (fieldId: string) => void,
): PanelCommandItem[] {
  return fields.map((field) =>
    isSingleSelectField(field)
      ? {
          label: field.name,
          checked: activeId === field.id,
          action: () => onPick(field.id),
        }
      : {
          label: field.name,
          disabled: true,
          disabledReason: NOT_SINGLE_SELECT,
          action: () => {},
        },
  );
}

/**
 * Field pickers for the board's View menus: "Group by" radios over single-select enum fields
 * (other field kinds listed disabled with the reason), and "Cards" checkboxes over all fields
 * whose values render read-only on each card.
 */
function boardCommandGroups(
  slot: WorkspacePanelSlot,
  { fields, updatePanel }: TrackerControlsContext,
): PanelCommandGroup[] {
  if (slot.panel.type !== 'board') return [];
  const boardPanel = slot.panel as BoardPanel;
  const setConfig = (changes: Partial<BoardPanel['config']>) =>
    updatePanel(slot, { ...boardPanel, config: { ...boardPanel.config, ...changes } });
  const cardItems: PanelCommandItem[] = fields.map((field) => {
    const selected = boardPanel.config.cardFieldIds.includes(field.id);
    return {
      label: field.name,
      checked: selected,
      action: () => {
        if (selected) {
          setConfig({
            cardFieldIds: boardPanel.config.cardFieldIds.filter((id) => id !== field.id),
          });
          return;
        }
        if (boardPanel.config.cardFieldIds.length >= 50) return;
        setConfig({ cardFieldIds: [...boardPanel.config.cardFieldIds, field.id] });
      },
    };
  });
  return [
    {
      label: 'Group by',
      items: singleSelectChoices(
        fields,
        boardPanel.config.groupByFieldId,
        (fieldId) => setConfig({ groupByFieldId: fieldId }),
      ),
    },
    { label: 'Cards', items: cardItems },
  ];
}

/**
 * Axis pickers for the matrix's View menus — one radio list per axis over single-select enum
 * fields only, with other field kinds disabled and the reason attached.
 */
function matrixCommandGroups(
  slot: WorkspacePanelSlot,
  { fields, updatePanel }: TrackerControlsContext,
): PanelCommandGroup[] {
  if (slot.panel.type !== 'matrix') return [];
  const matrixPanel = slot.panel as MatrixPanel;
  const setConfig = (changes: Partial<MatrixPanel['config']>) =>
    updatePanel(slot, { ...matrixPanel, config: { ...matrixPanel.config, ...changes } });
  return [
    {
      label: 'Rows',
      items: singleSelectChoices(
        fields,
        matrixPanel.config.rowFieldId,
        (fieldId) => setConfig({ rowFieldId: fieldId }),
      ),
    },
    {
      label: 'Columns',
      items: singleSelectChoices(
        fields,
        matrixPanel.config.colFieldId,
        (fieldId) => setConfig({ colFieldId: fieldId }),
      ),
    },
  ];
}

function renderControls(context: TrackerControls): ReactNode {
  const { slot, controls, dispatchAction } = context;
  const menus: PanelCommandGroup[] = [];
  const gridItems = gridCommands(slot, controls, dispatchAction);
  if (gridItems) menus.push({ label: 'View', items: gridItems });
  menus.push(...boardCommandGroups(slot, controls));
  menus.push(...matrixCommandGroups(slot, controls));
  const inspectorItems = inspectorCommands(slot, controls);
  if (inspectorItems) menus.push({ label: 'View', items: inspectorItems });
  let recordItems: PanelCommandItem[] | undefined;
  if (slot.panel.type === 'grid') {
    recordItems = [
      {
        label: 'Add record…',
        disabled: !controls.canEditRecords,
        action: () => dispatchAction('add-record'),
      },
      {
        label: 'Delete selected…',
        disabled: !controls.canEditRecords || !controls.selectedRecord,
        action: () => dispatchAction('delete-selected'),
      },
    ];
  }
  return (
    <>
      <TrackerPanelPicker slot={slot} controls={controls} />
      <nav className={styles.editorCommands}>
        {menus
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <PanelCommandMenu key={group.label} label={group.label} items={group.items} />
          ))}
        {recordItems && <PanelCommandMenu label="Record" items={recordItems} />}
      </nav>
      {slot.panel.type === 'grid' && (
        <TrackerGridHeaderControls
          panel={slot.panel}
          fields={controls.fields}
          onPanelChange={(panel) => controls.updatePanel(slot, panel)}
        />
      )}
    </>
  );
}

function definitionFor(
  type: TrackerPanelType,
  label: string,
  icon: ReactNode,
): WorkspacePanelRegistry<WorkspacePanel, TrackerControlsContext>['definitions'][number] {
  return {
    type,
    label,
    icon,
    createPanel: (id) => createPanel(type, id),
    controls: renderControls,
  };
}

export const trackerPanelRegistry: WorkspacePanelRegistry<
  WorkspacePanel,
  TrackerControlsContext
> = {
  definitions: [
    definitionFor('grid', 'Records', <TableIcon size={12} aria-hidden="true" />),
    definitionFor('board', 'Board', <KanbanIcon size={12} aria-hidden="true" />),
    definitionFor('matrix', 'Matrix', <GridFourIcon size={12} aria-hidden="true" />),
    definitionFor('inspector', 'Inspector', <TagSimpleIcon size={12} aria-hidden="true" />),
    definitionFor(
      'activity',
      'Activity',
      <ClockCounterClockwiseIcon size={12} aria-hidden="true" />,
    ),
  ],
  title,
};

/** Renders a tracker workspace panel body for the shell's renderPanel callback. */
export function renderTrackerPanelContent(
  slot: WorkspacePanelSlot,
  services: {
    trackerId: string;
    canEditRecords: boolean;
    selectedRecord?: TrackerRecord;
    currentUser: TrackerCurrentUser;
    onSelectRecord: (record: TrackerRecord | undefined) => void;
    updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
    onItemOperation?: (operation: {
      label: string;
      undo: () => Promise<void>;
      redo: () => Promise<void>;
    }) => void;
    pushToast: (message: string) => void;
  },
) {
  const { panel } = slot;
  if (panel.type === 'grid')
    return (
      <TrackerGridPanel
        trackerId={services.trackerId}
        panel={panel}
        canEdit={services.canEditRecords}
        selectedRecord={services.selectedRecord}
        onSelectRecord={services.onSelectRecord}
        onPanelChange={(next) => services.updatePanel(slot, next)}
        onItemOperation={services.onItemOperation}
        onOperationError={services.pushToast}
      />
    );
  if (panel.type === 'inspector')
    return (
      <TrackerInspectorPanel
        trackerId={services.trackerId}
        panel={panel}
        selectedRecord={services.selectedRecord}
        canEdit={services.canEditRecords}
        currentUser={services.currentUser}
        onItemOperation={services.onItemOperation}
      />
    );
  if (panel.type === 'board' || panel.type === 'matrix') {
    const board = panel.type === 'board';
    return (
      <Suspense fallback={<div className={styles.loading}><span>LOADING…</span></div>}>
        {board ? (
          <TrackerBoardPanel
            trackerId={services.trackerId}
            panel={panel as BoardPanel}
            canEdit={services.canEditRecords}
            selectedRecord={services.selectedRecord}
            onSelectRecord={services.onSelectRecord}
            onPanelChange={(next) => services.updatePanel(slot, next)}
            onItemOperation={services.onItemOperation}
            onOperationError={services.pushToast}
          />
        ) : (
          <TrackerMatrixPanel
            trackerId={services.trackerId}
            panel={panel as MatrixPanel}
            onSelectRecord={services.onSelectRecord}
          />
        )}
      </Suspense>
    );
  }
  if (panel.type === 'activity')
    return (
      <ActivityPanel
        projectId=""
        panel={panel}
        feedPath={`/api/v1/trackers/${services.trackerId}/activity`}
      />
    );
  return null;
}
