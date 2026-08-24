import {
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
} from '@coda/contracts';
import { createBrowserUuid } from '../browser-uuid';
import { freshGridConfig } from './tracker-model';

function id(): string {
  return createBrowserUuid();
}

/**
 * Client-side parity with the backend's canonical tracker default
 * (`createTrackerDefaultWorkspaceLayout`): a record grid beside an inspector. Used when a saved
 * layout is absent client-side and as the reset target preview; the server remains the authority.
 */
export function createDefaultTrackerWorkspaceLayout(): WorkspaceLayout {
  const root: WorkspaceLayoutNode = {
    kind: 'split',
    id: id(),
    axis: 'horizontal',
    ratioBasisPoints: 7000,
    first: {
      kind: 'panel',
      id: id(),
      panel: { id: id(), type: 'grid', configVersion: 1, config: freshGridConfig() },
    },
    second: {
      kind: 'panel',
      id: id(),
      panel: {
        id: id(),
        type: 'inspector',
        configVersion: 1,
        config: { section: 'details', search: '' },
      },
    },
  };
  return workspaceLayoutSchema.parse({
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    root,
    view: { zoom: 1, textScale: 1.2 },
  });
}
