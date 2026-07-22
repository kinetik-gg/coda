import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { FilmSlateIcon } from '@phosphor-icons/react/dist/csr/FilmSlate';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { WorkspacePanel, WorkspacePanelType } from '@coda/contracts';
import type { WorkspacePanelRegistry } from './types';

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

export const breakdownPanelRegistry: WorkspacePanelRegistry<WorkspacePanel> = {
  definitions: [
    {
      type: 'entity_table',
      label: 'Entity table',
      icon: <FilmSlateIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) => createPanel('entity_table', id, current),
    },
    {
      type: 'inspector',
      label: 'Inspector',
      icon: <TagSimpleIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) => createPanel('inspector', id, current),
    },
    {
      type: 'pdf',
      label: 'PDF Viewer',
      icon: <FilesIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) => createPanel('pdf', id, current),
    },
    {
      type: 'activity',
      label: 'Activity',
      icon: <ClockCounterClockwiseIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) => createPanel('activity', id, current),
    },
    {
      type: 'trash',
      label: 'Trash',
      icon: <TrashIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) => createPanel('trash', id, current),
    },
  ],
  title,
  menuName: (panel) => (panel.type === 'pdf' ? 'PDF source' : title(panel)),
};
