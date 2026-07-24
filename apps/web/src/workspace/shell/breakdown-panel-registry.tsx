import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { FilmSlateIcon } from '@phosphor-icons/react/dist/csr/FilmSlate';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { WorkspacePanel, WorkspacePanelSlot, WorkspacePanelType } from '@coda/contracts';
import { PanelCommandMenu, type PanelCommandItem } from '../PanelCommandMenu';
import { EntityTableHeaderControls } from '../panels/EntityTablePanel';
import { InspectorHeaderControls } from '../panels/InspectorPanel';
import { PdfPanelHeaderControls } from '../panels/PdfPanelHeaderControls';
import type { ActiveEntity, Project } from '../panels/types';
import { entityTypeIcon, PanelSelector } from '../WorkspacePanelSelector';
import styles from '../DenseWorkspace.module.css';
import type {
  WorkspacePanelControlsContext,
  WorkspacePanelMenuItem,
  WorkspacePanelRegistry,
} from './types';

/** Services the breakdown editor threads to its registry-declared panel controls. */
export interface BreakdownControlsContext {
  project: Project;
  projectId: string;
  activeEntity?: ActiveEntity;
  queryClient: QueryClient;
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
}

type BreakdownControls = WorkspacePanelControlsContext<WorkspacePanel, BreakdownControlsContext>;

function createPanel(
  type: WorkspacePanelType,
  panelId: string,
  current: WorkspacePanel,
): WorkspacePanel {
  if (current.type === type) return current;
  if (type === 'entity_table') {
    return {
      id: panelId,
      type,
      configVersion: 1,
      config: {
        entityTypeId: null,
        search: '',
        sort: 'manual',
        direction: 'asc',
        filters: [],
        hiddenColumns: [],
        visibleCustomFieldIds: [],
        columnWidths: {},
      },
    };
  }
  if (type === 'inspector') {
    return { id: panelId, type, configVersion: 1, config: { section: 'details', search: '' } };
  }
  if (type === 'pdf') {
    return {
      id: panelId,
      type,
      configVersion: 1,
      config: { sourceDocumentId: null, page: 1, zoom: 1 },
    };
  }
  return { id: panelId, type, configVersion: 1, config: { search: '' } };
}

function title(panel: WorkspacePanel): string {
  if (panel.type === 'entity_table') return 'Entity table';
  if (panel.type === 'inspector') return 'Inspector';
  if (panel.type === 'pdf') return 'PDF Viewer';
  if (panel.type === 'activity') return 'Activity';
  return 'Trash';
}

function panelIcon(slot: WorkspacePanelSlot, project: Project) {
  const panel = slot.panel;
  if (panel.type === 'entity_table') {
    const entityTypeId = panel.config.entityTypeId;
    const selectedEntityType = project.entityTypes.find(
      (entityType) => entityType.id === entityTypeId,
    );
    return entityTypeIcon(selectedEntityType?.level ?? 1);
  }
  if (panel.type === 'inspector') return TagSimpleIcon;
  if (panel.type === 'pdf') return FilesIcon;
  if (panel.type === 'activity') return ClockCounterClockwiseIcon;
  return TrashIcon;
}

function entityTableCommands(
  slot: WorkspacePanelSlot,
  { project, updatePanel }: BreakdownControlsContext,
  dispatchAction: (action: string) => void,
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
      { label: 'Refresh rows', action: () => dispatchAction('refresh') },
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
      { label: 'Select first row', action: () => dispatchAction('select-first') },
      { label: 'Select previous row', action: () => dispatchAction('select-previous') },
      { label: 'Select next row', action: () => dispatchAction('select-next') },
    ] satisfies PanelCommandItem[],
    addItems: [
      {
        label: `Add ${type?.singularName ?? 'item'}…`,
        disabled: !type || Boolean(parentType && (parentType._count?.items ?? 0) === 0),
        action: () => dispatchAction('add-item'),
      },
    ] satisfies PanelCommandItem[],
  };
}

function inspectorCommands(
  slot: WorkspacePanelSlot,
  { updatePanel }: BreakdownControlsContext,
): PanelCommandItem[] | undefined {
  if (slot.panel.type !== 'inspector') return undefined;
  const inspectorPanel = slot.panel;
  const section = (next: 'details' | 'comments' | 'references' | 'activity') =>
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

function renderControls(context: BreakdownControls): ReactNode {
  const { slot, controls, dispatchAction } = context;
  const { project, projectId, activeEntity, queryClient, updatePanel } = controls;
  const Icon = panelIcon(slot, project);
  const tableCommands = entityTableCommands(slot, controls, dispatchAction);
  let viewItems = tableCommands?.viewItems ?? inspectorCommands(slot, controls) ?? [];
  let selectItems = tableCommands?.selectItems ?? [];
  let addItems = tableCommands?.addItems ?? [];
  if (slot.panel.type === 'pdf') {
    const pdfPanel = slot.panel;
    viewItems = [
      {
        label: pdfPanel.config.darkView ? 'Use system PDF colors' : 'Toggle dark PDF',
        action: () => dispatchAction('toggle-dark'),
      },
    ];
    selectItems = [
      {
        label: 'Use current page as range',
        action: () => dispatchAction('use-current-page-range'),
      },
    ];
    addItems = [
      {
        label: 'Upload PDF…',
        disabled: project.sourceDocuments.length > 0,
        action: () => dispatchAction('upload-document'),
      },
      {
        label: 'Link range to selected item',
        disabled: !activeEntity,
        action: () => dispatchAction('link-range'),
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

function renderMenuItems(context: BreakdownControls): WorkspacePanelMenuItem[] {
  const { slot, controls, dispatchAction } = context;
  if (slot.panel.type !== 'entity_table') return [];
  const panel = slot.panel;
  const type = controls.project.entityTypes.find((entry) => entry.id === panel.config.entityTypeId);
  const parentType = type
    ? controls.project.entityTypes.find((entry) => entry.level === type.level - 1)
    : undefined;
  return [
    {
      label: `Add ${type?.singularName ?? 'item'}…`,
      disabled: !type || Boolean(parentType && (parentType._count?.items ?? 0) === 0),
      action: () => dispatchAction('add-item'),
    },
  ];
}

function definitionFor(
  type: WorkspacePanelType,
  label: string,
  icon: ReactNode,
): WorkspacePanelRegistry<WorkspacePanel, BreakdownControlsContext>['definitions'][number] {
  return {
    type,
    label,
    icon,
    createPanel: (id, current) => createPanel(type, id, current),
    controls: renderControls,
    menuItems: renderMenuItems,
  };
}

export const breakdownPanelRegistry: WorkspacePanelRegistry<
  WorkspacePanel,
  BreakdownControlsContext
> = {
  definitions: [
    definitionFor('entity_table', 'Entity table', <FilmSlateIcon size={12} aria-hidden="true" />),
    definitionFor('inspector', 'Inspector', <TagSimpleIcon size={12} aria-hidden="true" />),
    definitionFor('pdf', 'PDF Viewer', <FilesIcon size={12} aria-hidden="true" />),
    definitionFor(
      'activity',
      'Activity',
      <ClockCounterClockwiseIcon size={12} aria-hidden="true" />,
    ),
    definitionFor('trash', 'Trash', <TrashIcon size={12} aria-hidden="true" />),
  ],
  title,
  menuName: (panel) => (panel.type === 'pdf' ? 'PDF source' : title(panel)),
};
