import { useState, type CSSProperties } from 'react';
import {
  WORKSPACE_LAYOUT_MAX_DEPTH,
  WORKSPACE_LAYOUT_MAX_PANELS,
  type WorkspaceLayout,
  type WorkspacePanel,
  type WorkspacePanelSlot,
} from '@coda/contracts';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { workspaceFontScaleMultiplier } from '../account-preferences';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Tooltip } from '../components/Tooltip';
import type { Tracker, TrackerCurrentUser, TrackerField, TrackerRecord } from '../trackers/types';
import { StatusBar, StatusBarSegment } from './shell';
import { SaveStateChip } from './shell/SaveStateChip';
import type { SaveState } from './shell/save-state';
import { PanelWorkspaceShell } from './shell/WorkspaceShell';
import { reduceWorkspaceLayout } from './layout';
import {
  trackerPanelRegistry,
  renderTrackerPanelContent,
  type TrackerControlsContext,
} from './tracker-panel-registry';
import type { ItemOperation } from './panels/types';
import type { PublishConflict } from './workspace-status';
import dwsStyles from './DenseWorkspace.module.css';
import shellStyles from './shell/WorkspaceShell.module.css';

/**
 * The tracker workspace surface (#379): the generic panel shell driven by the tracker panel
 * registry, with a status bar (identity + selection), save-state chip, reset/publish actions
 * dispatching the shared window events, and the toast/publish-conflict chrome. Text scale and
 * zoom apply exactly like the breakdown — tokens multiplied by the layout's saved scale.
 */
export function TrackerWorkspaceView({
  layout,
  tracker,
  trackerId,
  fields,
  saveState,
  canUndo,
  onUndo,
  selectedRecord,
  onSelectRecord,
  currentUser,
  operationError,
  publishConflict,
  canPublish,
  onLayoutChange,
  updatePanel,
  registerOperation,
  onOperationError,
  onDismissError,
  onPublishOverwrite,
  onAdoptLatest,
  onDismissPublishConflict,
  onBack,
}: {
  layout: WorkspaceLayout;
  tracker: Tracker;
  trackerId: string;
  fields: TrackerField[];
  saveState: SaveState;
  canUndo: boolean;
  onUndo: () => void;
  selectedRecord?: TrackerRecord;
  onSelectRecord: (record: TrackerRecord | undefined) => void;
  currentUser: TrackerCurrentUser;
  operationError?: string;
  publishConflict?: PublishConflict;
  canPublish: boolean;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  updatePanel: (slot: WorkspacePanelSlot, panel: WorkspacePanel) => void;
  registerOperation: (operation: ItemOperation) => void;
  onOperationError: (message: string) => void;
  onDismissError: () => void;
  onPublishOverwrite: () => void;
  onAdoptLatest: () => void;
  onDismissPublishConflict: () => void;
  onBack: () => void;
}) {
  const [confirmation, setConfirmation] = useState<'reset' | 'publish'>();
  const view = layout.view ?? { zoom: 1, textScale: 1.2 };
  const effectiveTextScale = view.textScale * workspaceFontScaleMultiplier();
  const canEditRecords = tracker.access?.permissions?.includes('edit_tracker_records') ?? false;
  const controls: TrackerControlsContext = {
    trackerId,
    canEditRecords,
    fields,
    selectedRecord,
    updatePanel,
  };
  return (
    <div className={dwsStyles.host}>
      <div
        className={dwsStyles.workspaceScale}
        style={
          {
            '--workspace-zoom': view.zoom,
            '--workspace-text-scale': effectiveTextScale,
            width: `${100 / view.zoom}%`,
            height: `${100 / view.zoom}%`,
          } as CSSProperties
        }
      >
        <PanelWorkspaceShell
          layout={layout}
          onLayoutChange={(next) => onLayoutChange(next)}
          reduceLayout={reduceWorkspaceLayout}
          panelRegistry={trackerPanelRegistry}
          maxPanels={WORKSPACE_LAYOUT_MAX_PANELS}
          maxDepth={WORKSPACE_LAYOUT_MAX_DEPTH}
          renderPanel={({ slot }) =>
            renderTrackerPanelContent(slot, {
              trackerId,
              canEditRecords,
              selectedRecord,
              currentUser,
              onSelectRecord,
              updatePanel,
              onItemOperation: registerOperation,
              pushToast: onOperationError,
            })
          }
          controlsContext={controls}
          onOperationError={(error) => onOperationError(error.message)}
          toolbarStart={
            <StatusBar
              left={
                <>
                  <Tooltip content="Back to trackers">
                    <button type="button" className={dwsStyles.workspaceAction} onClick={onBack}>
                      ‹ Trackers
                    </button>
                  </Tooltip>
                  <StatusBarSegment>{tracker.name.toUpperCase()}</StatusBarSegment>
                  {selectedRecord && (
                    <StatusBarSegment tone="accent">
                      SELECTED:&nbsp;{selectedRecord.title}
                    </StatusBarSegment>
                  )}
                </>
              }
            />
          }
          toolbarEnd={
            <>
              {canUndo && (
                <Tooltip content="Undo the last record change">
                  <button type="button" className={shellStyles.iconButton} onClick={onUndo}>
                    <ArrowCounterClockwiseIcon size={12} weight="bold" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Restore your saved arrangement to the tracker default">
                <button
                  type="button"
                  className={dwsStyles.workspaceAction}
                  onClick={() => setConfirmation('reset')}
                >
                  Reset
                </button>
              </Tooltip>
              {canPublish && (
                <Tooltip content="Publish your arrangement as this tracker's default">
                  <button
                    type="button"
                    className={dwsStyles.workspaceAction}
                    onClick={() => setConfirmation('publish')}
                  >
                    Publish
                  </button>
                </Tooltip>
              )}
              <SaveStateChip state={saveState} />
            </>
          }
        />
      </div>
      {operationError && (
        <button className={dwsStyles.toast} onClick={onDismissError}>
          {operationError}
        </button>
      )}
      {publishConflict && (
        <div
          className={dwsStyles.publishConflict}
          role="alertdialog"
          aria-label="Published layout changed"
        >
          <p className={dwsStyles.publishConflictMessage}>
            The published layout changed while you were publishing. Overwrite it with yours, or
            adopt the latest published layout?
          </p>
          <div className={dwsStyles.publishConflictActions}>
            <button type="button" onClick={onAdoptLatest}>
              Adopt latest
            </button>
            <button
              type="button"
              className={dwsStyles.publishConflictPrimary}
              onClick={onPublishOverwrite}
            >
              Publish anyway (overwrites)
            </button>
            <button
              type="button"
              className={dwsStyles.publishConflictDismiss}
              aria-label="Dismiss"
              onClick={onDismissPublishConflict}
            >
              ×
            </button>
          </div>
        </div>
      )}
      {confirmation && (
        <ConfirmationDialog
          title={
            confirmation === 'reset'
              ? 'Reset workspace layout?'
              : 'Publish this layout as the default?'
          }
          description={
            confirmation === 'reset' ? (
              <p>
                This replaces your saved panel arrangement with the tracker default. The current
                arrangement cannot be recovered.
              </p>
            ) : (
              <p>
                This replaces the default panel arrangement for tracker members. The previous
                default cannot be recovered.
              </p>
            )
          }
          confirmLabel={confirmation === 'reset' ? 'Reset workspace' : 'Publish default'}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => {
            // The same window-event convention the breakdown masthead uses; the screen's command
            // binding translates them into the layout sync's queued reset/publish.
            window.dispatchEvent(
              new CustomEvent(
                confirmation === 'reset' ? 'coda:reset-workspace' : 'coda:publish-workspace',
              ),
            );
            setConfirmation(undefined);
          }}
        />
      )}
    </div>
  );
}
