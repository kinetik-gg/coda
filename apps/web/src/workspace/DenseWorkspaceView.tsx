import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { WorkspaceLayout, WorkspacePanel, WorkspacePanelSlot } from '@coda/contracts';
import { workspaceFontScaleMultiplier } from '../account-preferences';
import { Tooltip } from '../components/Tooltip';
import { PanelContent } from './panels/PanelContent';
import type { ActiveEntity, ItemOperation, Project } from './panels/types';
import {
  SaveStateChip,
  StatusBar,
  StatusBarSegment,
  WorkspaceShell,
  type BreakdownControlsContext,
  type SaveState,
} from './shell';
import styles from './DenseWorkspace.module.css';

function VersionSegment() {
  return <StatusBarSegment>CODA V0.0.2</StatusBarSegment>;
}

function CountsSegment({ project }: { project: Project }) {
  return (
    <StatusBarSegment>
      {project.entityTypes
        .map((type) => `${type._count?.items ?? 0} ${type.pluralName.toUpperCase()}`)
        .join('  |  ')}
    </StatusBarSegment>
  );
}

function SelectedEntitySegment({ activeEntity }: { activeEntity?: ActiveEntity }) {
  if (!activeEntity) return null;
  return (
    <Tooltip content="This item is the active selection across all panels">
      <StatusBarSegment tone="accent" className={styles.selectedEntityStatus}>
        SELECTED {activeEntity.entityType.singularName.toUpperCase()}:&nbsp;
        {activeEntity.item.displayCode && `${activeEntity.item.displayCode} — `}
        {activeEntity.item.title}
      </StatusBarSegment>
    </Tooltip>
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
  saveState: SaveState;
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
          controlsContext={
            {
              project,
              projectId,
              activeEntity,
              queryClient,
              updatePanel,
            } satisfies BreakdownControlsContext
          }
          onOperationError={onOperationError}
          toolbarStart={
            <StatusBar
              left={
                <>
                  <VersionSegment />
                  <CountsSegment project={project} />
                  <SelectedEntitySegment activeEntity={activeEntity} />
                </>
              }
            />
          }
          toolbarEnd={<SaveStateChip state={saveState} />}
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
