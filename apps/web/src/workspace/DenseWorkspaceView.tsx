import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { WorkspaceLayout, WorkspacePanel, WorkspacePanelSlot } from '@coda/contracts';
import { workspaceFontScaleMultiplier } from '../account-preferences';
import { Tooltip } from '../components/Tooltip';
import { PanelCommandMenu, type PanelCommandItem } from './PanelCommandMenu';
import { EntityTableHeaderControls } from './panels/EntityTablePanel';
import { InspectorHeaderControls } from './panels/InspectorPanel';
import { PanelContent } from './panels/PanelContent';
import { PdfPanelHeaderControls } from './panels/PdfPanel';
import type { ActiveEntity, ItemOperation, Project } from './panels/types';
import { WorkspaceShell } from './shell';
import { entityTypeIcon, PanelSelector } from './WorkspacePanelSelector';
import { resolveWorkspaceStatus, type LayoutSaveState } from './workspace-status';
import styles from './DenseWorkspace.module.css';

function dispatchPanelAction(panelId: string, action: string): void {
  window.dispatchEvent(new CustomEvent('coda:panel-action', { detail: { panelId, action } }));
}

function panelMenuItems(slot: WorkspacePanelSlot, project: Project): PanelCommandItem[] {
  const panel = slot.panel;
  if (panel.type !== 'entity_table') return [];
  const type = project.entityTypes.find((entry) => entry.id === panel.config.entityTypeId);
  const parentType = type
    ? project.entityTypes.find((entry) => entry.level === type.level - 1)
    : undefined;
  return [
    {
      label: `Add ${type?.singularName ?? 'item'}…`,
      disabled: !type || Boolean(parentType && (parentType._count?.items ?? 0) === 0),
      action: () => dispatchPanelAction(panel.id, 'add-item'),
    },
  ];
}

function panelIcon(slot: WorkspacePanelSlot, project: Project) {
  const selectedEntityTypeId =
    slot.panel.type === 'entity_table' ? slot.panel.config.entityTypeId : null;
  const selectedEntityType = project.entityTypes.find(
    (entityType) => entityType.id === selectedEntityTypeId,
  );
  if (slot.panel.type === 'entity_table') return entityTypeIcon(selectedEntityType?.level ?? 1);
  if (slot.panel.type === 'inspector') return TagSimpleIcon;
  if (slot.panel.type === 'pdf') return FilesIcon;
  if (slot.panel.type === 'activity') return ClockCounterClockwiseIcon;
  return TrashIcon;
}

function entityTableCommands(
  slot: WorkspacePanelSlot,
  project: Project,
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void,
) {
  if (slot.panel.type !== 'entity_table') return undefined;
  const tablePanel = slot.panel;
  const updateTable = (changes: Partial<typeof tablePanel.config>) =>
    updatePanel(slot, { ...tablePanel, config: { ...tablePanel.config, ...changes } });
  const type = project.entityTypes.find((entry) => entry.id === tablePanel.config.entityTypeId);
  const parentType = type
    ? project.entityTypes.find((entry) => entry.level === type.level - 1)
    : undefined;
  return {
    viewItems: [
      { label: 'Refresh rows', action: () => dispatchPanelAction(tablePanel.id, 'refresh') },
      {
        label: 'Manual order',
        checked: tablePanel.config.sort === 'manual',
        separatorBefore: true,
        action: () => updateTable({ sort: 'manual' }),
      },
      {
        label: 'Sort by code',
        checked: tablePanel.config.sort === 'code',
        action: () => updateTable({ sort: 'code' }),
      },
      {
        label: 'Sort by name',
        checked: tablePanel.config.sort === 'title',
        action: () => updateTable({ sort: 'title' }),
      },
      {
        label: 'Ascending',
        checked: tablePanel.config.direction === 'asc',
        separatorBefore: true,
        action: () => updateTable({ direction: 'asc' }),
      },
      {
        label: 'Descending',
        checked: tablePanel.config.direction === 'desc',
        action: () => updateTable({ direction: 'desc' }),
      },
    ] satisfies PanelCommandItem[],
    selectItems: [
      {
        label: 'Select first row',
        action: () => dispatchPanelAction(tablePanel.id, 'select-first'),
      },
      {
        label: 'Select previous row',
        action: () => dispatchPanelAction(tablePanel.id, 'select-previous'),
      },
      {
        label: 'Select next row',
        action: () => dispatchPanelAction(tablePanel.id, 'select-next'),
      },
    ] satisfies PanelCommandItem[],
    addItems: [
      {
        label: `Add ${type?.singularName ?? 'item'}…`,
        disabled: !type || Boolean(parentType && (parentType._count?.items ?? 0) === 0),
        action: () => dispatchPanelAction(tablePanel.id, 'add-item'),
      },
    ] satisfies PanelCommandItem[],
  };
}

function inspectorCommands(
  slot: WorkspacePanelSlot,
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void,
): PanelCommandItem[] | undefined {
  if (slot.panel.type !== 'inspector') return undefined;
  const inspectorPanel = slot.panel;
  const section = (next: 'details' | 'comments' | 'references' | 'activity') =>
    updatePanel(slot, {
      ...inspectorPanel,
      config: { ...inspectorPanel.config, section: next },
    });
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
      label: 'Source references',
      checked: inspectorPanel.config.section === 'references',
      action: () => section('references'),
    },
    {
      label: 'Activity',
      checked: inspectorPanel.config.section === 'activity',
      action: () => section('activity'),
    },
  ];
}

function PanelToolbar({
  slot,
  project,
  projectId,
  activeEntity,
  queryClient,
  updatePanel,
}: {
  slot: WorkspacePanelSlot;
  project: Project;
  projectId: string;
  activeEntity?: ActiveEntity;
  queryClient: QueryClient;
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
}) {
  const Icon = panelIcon(slot, project);
  const tableCommands = entityTableCommands(slot, project, updatePanel);
  let viewItems = tableCommands?.viewItems ?? inspectorCommands(slot, updatePanel) ?? [];
  let selectItems = tableCommands?.selectItems ?? [];
  let addItems = tableCommands?.addItems ?? [];
  if (slot.panel.type === 'pdf') {
    const pdfPanel = slot.panel;
    viewItems = [
      {
        label: pdfPanel.config.darkView ? 'Use system PDF colors' : 'Toggle dark PDF',
        action: () => dispatchPanelAction(pdfPanel.id, 'toggle-dark'),
      },
    ];
    selectItems = [
      {
        label: 'Use current page as range',
        action: () => dispatchPanelAction(pdfPanel.id, 'use-current-page-range'),
      },
    ];
    addItems = [
      {
        label: 'Upload PDF…',
        disabled: project.sourceDocuments.length > 0,
        action: () => dispatchPanelAction(pdfPanel.id, 'upload-document'),
      },
      {
        label: 'Link range to selected item',
        disabled: !activeEntity,
        action: () => dispatchPanelAction(pdfPanel.id, 'link-range'),
      },
    ];
  } else if (slot.panel.type !== 'entity_table' && slot.panel.type !== 'inspector') {
    viewItems = [
      {
        label: 'Refresh',
        action: () =>
          void queryClient.invalidateQueries({ queryKey: [slot.panel.type, projectId] }),
      },
    ];
  }

  return (
    <>
      <PanelSelector
        slot={slot}
        project={project}
        icon={<Icon size={12} aria-hidden="true" />}
        onChange={(panel) => updatePanel(slot, panel)}
      />
      <nav className={styles.editorCommands}>
        {viewItems.length > 0 && <PanelCommandMenu label="View" items={viewItems} />}
        {selectItems.length > 0 && <PanelCommandMenu label="Select" items={selectItems} />}
        {addItems.length > 0 && <PanelCommandMenu label="Add" items={addItems} />}
      </nav>
      {slot.panel.type === 'entity_table' && (
        <EntityTableHeaderControls
          project={project}
          projectId={projectId}
          panel={slot.panel}
          onPanelChange={(panel) => updatePanel(slot, panel)}
        />
      )}
      {slot.panel.type === 'inspector' && (
        <InspectorHeaderControls
          panel={slot.panel}
          onPanelChange={(panel) => updatePanel(slot, panel)}
        />
      )}
      {slot.panel.type === 'pdf' && (
        <PdfPanelHeaderControls
          project={project}
          panel={slot.panel}
          onPanelChange={(panel) => updatePanel(slot, panel)}
        />
      )}
    </>
  );
}

function SaveStatus({
  saveState,
  savedNoticeVisible,
  loading,
  updating,
}: {
  saveState: LayoutSaveState;
  savedNoticeVisible: boolean;
  loading: number;
  updating: number;
}) {
  const statusKind = resolveWorkspaceStatus({ saveState, savedNoticeVisible, loading, updating });
  const status =
    statusKind === 'loading' ? (
      <>
        <SpinnerGapIcon size={12} className={styles.spin} /> LOADING
      </>
    ) : statusKind === 'updating' ? (
      <>
        <SpinnerGapIcon size={12} className={styles.spin} /> UPDATING
      </>
    ) : statusKind === 'saving' ? (
      <>
        <SpinnerGapIcon size={12} className={styles.spin} /> SAVING
      </>
    ) : statusKind === 'saved' ? (
      <>
        <CheckIcon size={12} /> SAVED
      </>
    ) : statusKind === 'error' ? (
      <>SAVE ERROR</>
    ) : (
      <>IDLE</>
    );
  return (
    <span
      className={`${styles.saveState} ${statusKind === 'error' ? styles.saveError : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {status}
    </span>
  );
}

export function DenseWorkspaceView({
  layout,
  project,
  projectId,
  currentUserId,
  activeEntity,
  setActiveEntity,
  saveState,
  savedNoticeVisible,
  loading,
  updating,
  operationError,
  queryClient,
  onLayoutChange,
  updatePanel,
  registerItemOperation,
  onOperationError,
  onDismissError,
}: {
  layout: WorkspaceLayout;
  project: Project;
  projectId: string;
  currentUserId: string;
  activeEntity?: ActiveEntity;
  setActiveEntity: Dispatch<SetStateAction<ActiveEntity | undefined>>;
  saveState: LayoutSaveState;
  savedNoticeVisible: boolean;
  loading: number;
  updating: number;
  operationError?: string;
  queryClient: QueryClient;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
  registerItemOperation: (operation: ItemOperation) => void;
  onOperationError: (error: Error) => void;
  onDismissError: () => void;
}) {
  const view = layout.view ?? { zoom: 1, textScale: 1.2 };
  const effectiveTextScale = view.textScale * workspaceFontScaleMultiplier();
  return (
    <div className={styles.host}>
      <div
        className={styles.workspaceScale}
        style={
          {
            '--workspace-zoom': view.zoom,
            '--workspace-text-scale': effectiveTextScale,
            width: `${100 / view.zoom}%`,
            height: `${100 / view.zoom}%`,
          } as CSSProperties
        }
      >
        <WorkspaceShell
          layout={layout}
          onLayoutChange={onLayoutChange}
          renderPanel={({ slot }) => (
            <PanelContent
              project={project}
              projectId={projectId}
              currentUserId={currentUserId}
              panel={slot.panel}
              activeEntity={activeEntity}
              onSelectEntity={setActiveEntity}
              onPanelChange={(panel) => updatePanel(slot, panel)}
              onItemOperation={registerItemOperation}
            />
          )}
          renderPanelMenuItems={({ slot }) => panelMenuItems(slot, project)}
          renderPanelToolbar={({ slot }) => (
            <PanelToolbar
              slot={slot}
              project={project}
              projectId={projectId}
              activeEntity={activeEntity}
              queryClient={queryClient}
              updatePanel={updatePanel}
            />
          )}
          onOperationError={onOperationError}
          toolbarStart={
            <span className={styles.version}>
              <span>
                CODA V0.0.2&nbsp; - &nbsp;
                {project.entityTypes
                  .map((type) => `${type._count?.items ?? 0} ${type.pluralName.toUpperCase()}`)
                  .join('  |  ')}
              </span>
              {activeEntity && (
                <>
                  <span aria-hidden="true">&nbsp; | &nbsp;</span>
                  <Tooltip content="This item is the active selection across all panels">
                    <span className={styles.selectedEntityStatus}>
                      SELECTED {activeEntity.entityType.singularName.toUpperCase()}:&nbsp;
                      {activeEntity.item.displayCode && `${activeEntity.item.displayCode} — `}
                      {activeEntity.item.title}
                    </span>
                  </Tooltip>
                </>
              )}
            </span>
          }
          toolbarEnd={
            <SaveStatus
              saveState={saveState}
              savedNoticeVisible={savedNoticeVisible}
              loading={loading}
              updating={updating}
            />
          }
        />
      </div>
      {operationError && (
        <button className={styles.toast} onClick={onDismissError}>
          {operationError}
        </button>
      )}
    </div>
  );
}
