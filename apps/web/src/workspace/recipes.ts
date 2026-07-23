import {
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
  type WorkspacePanel,
  type WorkspacePanelType,
} from '@coda/contracts';
import { createBrowserUuid } from '../browser-uuid';

export interface RecipeEntityType {
  id: string;
  level: number;
}

function id(): string {
  return createBrowserUuid();
}

function panel(type: WorkspacePanelType, entityTypeId: string | null = null): WorkspaceLayoutNode {
  let instance: WorkspacePanel;
  if (type === 'entity_table') {
    instance = {
      id: id(),
      type,
      configVersion: 1,
      config: {
        entityTypeId,
        search: '',
        sort: 'manual',
        direction: 'asc',
        filters: [],
        hiddenColumns: [],
        visibleCustomFieldIds: [],
        columnWidths: {},
      },
    };
  } else if (type === 'inspector') {
    instance = { id: id(), type, configVersion: 1, config: { section: 'details', search: '' } };
  } else if (type === 'pdf') {
    instance = {
      id: id(),
      type,
      configVersion: 1,
      config: { sourceDocumentId: null, page: 1, zoom: 1 },
    };
  } else {
    instance = { id: id(), type, configVersion: 1, config: { search: '' } };
  }
  return { kind: 'panel', id: id(), panel: instance };
}

function split(
  axis: 'horizontal' | 'vertical',
  ratioBasisPoints: number,
  first: WorkspaceLayoutNode,
  second: WorkspaceLayoutNode,
): WorkspaceLayoutNode {
  return { kind: 'split', id: id(), axis, ratioBasisPoints, first, second };
}

export function createWorkspaceRecipe(entityTypes: RecipeEntityType[]): WorkspaceLayout {
  const ordered = [...entityTypes].sort((a, b) => a.level - b.level);
  const table = (index: number) =>
    panel('entity_table', ordered[index]?.id ?? ordered[0]?.id ?? null);
  let root: WorkspaceLayoutNode;
  if (ordered.length <= 1) {
    root = split('horizontal', 6800, table(0), panel('inspector'));
  } else if (ordered.length === 2) {
    root = split(
      'horizontal',
      7000,
      split('vertical', 5000, table(0), table(1)),
      panel('inspector'),
    );
  } else {
    root = split(
      'horizontal',
      6200,
      split(
        'horizontal',
        3300,
        split('vertical', 1700, table(0), table(1)),
        split('vertical', 4880, table(2), panel('inspector')),
      ),
      panel('pdf'),
    );
  }
  return workspaceLayoutSchema.parse({
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    root,
    view: { zoom: 1, textScale: 1.2 },
  });
}
