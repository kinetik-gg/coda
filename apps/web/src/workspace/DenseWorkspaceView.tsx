import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import type { WorkspaceLayout, WorkspacePanel, WorkspacePanelSlot } from '@coda/contracts';
import { workspaceFontScaleMultiplier } from '../account-preferences';
import { Tooltip } from '../components/Tooltip';
import { PanelContent } from './panels/PanelContent';
import type { ActiveEntity, ItemOperation, Project } from './panels/types';
import { WorkspaceShell, type BreakdownControlsContext } from './shell';
import { resolveWorkspaceStatus, type LayoutSaveState } from './workspace-status';
import styles from './DenseWorkspace.module.css';

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
