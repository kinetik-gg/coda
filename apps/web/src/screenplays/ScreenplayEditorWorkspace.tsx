import { lazy, Suspense, useCallback, useMemo, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { FlowerLotusIcon } from '@phosphor-icons/react/dist/csr/FlowerLotus';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import { collectPanelSlots } from '../workspace/layout';
import { Tooltip } from '../components/Tooltip';
import { FountainEditor } from './FountainEditor';
import type { ScreenplayContextModel } from './screenplay-context-model';
import type { ScreenplayCommandState } from './screenplay-commands';
import {
  reduceScreenplayPanelLayout,
  type ScreenplayPanel,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';
import { screenplayPaper, type ScreenplayPaperSize } from './screenplay-paper';
import { ScreenplayPreview } from './ScreenplayPreview';
import { ScreenplayPanelToolbar, screenplayPreviewZoom } from './ScreenplayPanelToolbar';
import type { ScreenplaySceneMetadata } from './screenplay-scene-metadata';
import type { ScreenplayStatisticsModel } from './screenplay-statistics-model';
import type {
  ScreenplayPreviewModel,
  ScreenplaySceneOutlineItem,
  ScreenplaySourceSelection,
} from './screenplay-preview-model';
import {
  clampScreenplaySourceOffset,
  clampScreenplaySourceSelection,
} from './screenplay-source-selection';
import { ScreenplayWorkspaceShell } from './ScreenplayWorkspaceShell';
import type { SaveStatus } from './types';
import styles from './ScreenplayEditorScreen.module.css';

const ScreenplayStatisticsPanel = lazy(() =>
  import('./ScreenplayStatisticsPanel').then((module) => ({
    default: module.ScreenplayStatisticsPanel,
  })),
);

const statusLabels: Record<SaveStatus, string> = {
  conflict: 'SAVE CONFLICT',
  failed: 'SAVE ERROR',
  offline: 'OFFLINE · LOCAL CHANGES KEPT',
  saved: 'SAVED',
  saving: 'SAVING',
  unsaved: 'UNSAVED',
};

interface WorkspaceLayoutState {
  value: ScreenplayPanelLayout;
  activeSlotId: string;
  fullscreenSlotId: string | null;
  canUndo: boolean;
  onUndo: () => void;
  onChange: (layout: ScreenplayPanelLayout) => void;
  onActiveSlotChange: (slotId: string) => void;
  onFullscreenChange: (slotId: string | null) => void;
}

interface WorkspaceDocumentState {
  draft: string;
  analysisDraft: string;
  paperSize: ScreenplayPaperSize;
  saveStatus: SaveStatus;
  previewModel: ScreenplayPreviewModel;
  contextModel: ScreenplayContextModel;
  statisticsModel: ScreenplayStatisticsModel;
  visibleScenes: readonly ScreenplaySceneOutlineItem[];
  activeScene?: ScreenplaySceneOutlineItem;
  wordCount: number;
  currentLine: number;
  commandState: ScreenplayCommandState;
  sourceSelection: ScreenplaySourceSelection;
  previewSyncOffset: number;
  onDraftChange: (value: string) => void;
  onSave: () => Promise<boolean>;
  onCursorChange: (offset: number) => void;
  onSourceSelectionChange: (selection: ScreenplaySourceSelection) => void;
  onPreviewSyncChange: (offset: number) => void;
}

interface WorkspaceEditorBridge {
  previewDrivenScroll: RefObject<boolean>;
  previewSelectionInProgress: RefObject<boolean>;
  onReady: (slotId: string, view: EditorView | undefined) => void;
  getActiveView: () => EditorView | undefined;
  isActive: (slotId: string) => boolean;
  revealSource: (sourceOffset: number, focus?: boolean) => void;
}

interface WorkspaceActions {
  toggleZen: (slotId?: string) => void;
  exportPdf: () => void;
  reportError: (message: string) => void;
}

interface ScreenplayEditorWorkspaceProps {
  zenMode: boolean;
  layout: WorkspaceLayoutState;
  document: WorkspaceDocumentState;
  editor: WorkspaceEditorBridge;
  actions: WorkspaceActions;
}

function SaveState({ status }: { status: SaveStatus }) {
  const busy = status === 'saving';
  return (
    <span
      className={`${styles.saveState} ${styles[`save${status}`] ?? ''}`}
      role="status"
      aria-live="polite"
    >
      {busy ? <SpinnerGapIcon size={11} className={styles.spin} /> : <CheckIcon size={11} />}
      {statusLabels[status]}
    </span>
  );
}

function OutlinePanel({
  scenes,
  activeSceneId,
  filter,
  metadata,
  sceneMetadata,
  onSelect,
}: {
  scenes: readonly ScreenplaySceneOutlineItem[];
  activeSceneId?: string;
  filter: string;
  metadata: Extract<ScreenplayPanel, { type: 'outline' }>['config']['metadata'];
  sceneMetadata: ReadonlyMap<string, ScreenplaySceneMetadata>;
  onSelect: (scene: ScreenplaySceneOutlineItem) => void;
}) {
  const query = filter.trim().toLocaleLowerCase();
  const visibleScenes = query
    ? scenes.filter((scene) => scene.label.toLocaleLowerCase().includes(query))
    : scenes;
  return (
    <div className={styles.outlinePanel}>
      <nav className={styles.outlineList} aria-label="Screenplay scenes">
        {visibleScenes.map((scene, index) => {
          const detail = outlineSceneDetail(metadata, sceneMetadata.get(scene.id));
          return (
            <button
              key={scene.id}
              type="button"
              aria-current={scene.id === activeSceneId ? 'location' : undefined}
              onClick={() => onSelect(scene)}
            >
              <span>{scene.sceneNumber ?? String(index + 1).padStart(2, '0')}</span>
              <strong>{scene.label}</strong>
              <small>
                PAGE {scene.pageNumber}
                {detail ? ` · ${detail}` : ''}
              </small>
            </button>
          );
        })}
        {!visibleScenes.length && <p>No matching scenes.</p>}
      </nav>
    </div>
  );
}

function outlineSceneDetail(
  mode: Extract<ScreenplayPanel, { type: 'outline' }>['config']['metadata'],
  metadata?: ScreenplaySceneMetadata,
): string | undefined {
  if (!metadata || mode === 'none') return undefined;
  if (mode === 'pages' && metadata.estimatedPages !== undefined) {
    return `${metadata.estimatedPages.toFixed(2)} PAGES`;
  }
  if (mode === 'dialogue-density' && metadata.dialogueDensity !== undefined) {
    return `${Math.round(metadata.dialogueDensity * 100).toLocaleString()}% DIALOGUE`;
  }
  if (mode === 'duration' && metadata.estimatedDurationSeconds !== undefined) {
    const minutes = Math.floor(metadata.estimatedDurationSeconds / 60);
    const seconds = Math.round(metadata.estimatedDurationSeconds % 60);
    return `EST. ${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }
  return undefined;
}

type InventoryView = 'characters' | 'locations' | 'times' | 'sections' | 'notes';

function InventoryPanel({
  model,
  view,
  search,
  onReveal,
}: {
  model: ScreenplayContextModel;
  view: InventoryView;
  search: string;
  onReveal: (sourceOffset: number) => void;
}) {
  const query = search.trim().toLocaleLowerCase();
  const items = useMemo(() => {
    if (view === 'characters') {
      return model.characters.map((item) => ({
        id: item.id,
        label: item.name,
        detail: `${String(item.sceneIds.length)} scenes · ${String(item.dialogueWordCount)} words`,
        offset: item.cueRanges[0]?.start ?? 0,
      }));
    }
    if (view === 'locations') {
      return model.locations.map((item) => ({
        id: item.id,
        label: item.name,
        detail: `${String(item.sceneIds.length)} scenes`,
        offset: item.occurrences[0]?.range.start ?? 0,
      }));
    }
    if (view === 'times') {
      return model.timesOfDay.map((item) => ({
        id: item.id,
        label: item.name,
        detail: `${String(item.sceneIds.length)} scenes`,
        offset: item.occurrences[0]?.range.start ?? 0,
      }));
    }
    if (view === 'sections') {
      return model.sections.map((item) => ({
        id: item.id,
        label: item.text,
        detail: `Level ${String(item.depth)} · ${String(item.sceneIds.length)} scenes`,
        offset: item.range.start,
      }));
    }
    return model.notes.map((item) => ({
      id: item.id,
      label: item.text || 'Empty note',
      detail: item.sceneId ? 'Scene note' : 'Document note',
      offset: item.range.start,
    }));
  }, [model, view]);
  const visibleItems = query
    ? items.filter((item) => item.label.toLocaleLowerCase().includes(query))
    : items;
  return (
    <div className={styles.inventoryPanel}>
      <nav className={styles.inventoryList} aria-label="Screenplay inventory">
        {visibleItems.map((item) => (
          <button key={item.id} type="button" onClick={() => onReveal(item.offset)}>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
        {!visibleItems.length && <p>No matching inventory items.</p>}
      </nav>
    </div>
  );
}

function ScreenplayStatusBar({ document }: { document: WorkspaceDocumentState }) {
  const bodyPageCount = document.previewModel.pages.filter(
    (page) => page.pageNumber !== null,
  ).length;
  return (
    <div className={styles.statusBar}>
      <span>
        CODA WRITER&nbsp; · &nbsp;FOUNTAIN 1.1&nbsp; | &nbsp;
        {document.previewModel.scenes.length.toLocaleString()} SCENES&nbsp; | &nbsp;
        {document.wordCount.toLocaleString()} WORDS&nbsp; | &nbsp;
        {bodyPageCount.toLocaleString()} PAGES&nbsp; | &nbsp;
        {screenplayPaper(document.paperSize).shortLabel.toUpperCase()}
      </span>
      <span className={styles.statusContext}>
        LN {document.currentLine.toLocaleString()}&nbsp; | &nbsp;
        {document.commandState.grammarCheckEnabled ? 'SPELLING ON' : 'SPELLING OFF'}
      </span>
      <SaveState status={document.saveStatus} />
    </div>
  );
}

export function ScreenplayEditorWorkspace({
  zenMode,
  layout,
  document,
  editor,
  actions,
}: ScreenplayEditorWorkspaceProps) {
  const outlineMetadataEnabled = useMemo(
    () =>
      collectPanelSlots(layout.value.root).some(
        (slot) => slot.panel.type === 'outline' && slot.panel.config.metadata !== 'none',
      ),
    [layout.value],
  );
  const sceneMetadata = useMemo(() => {
    if (!outlineMetadataEnabled) return new Map<string, ScreenplaySceneMetadata>();
    const metadata = document.statisticsModel.sceneMetadata;
    return new Map(
      document.visibleScenes.flatMap((scene, index) =>
        metadata[index] ? [[scene.id, metadata[index]] as const] : [],
      ),
    );
  }, [document.statisticsModel.sceneMetadata, document.visibleScenes, outlineMetadataEnabled]);
  const { onCursorChange, onPreviewSyncChange, onSourceSelectionChange } = document;
  const {
    getActiveView,
    isActive: isActiveEditor,
    previewDrivenScroll,
    previewSelectionInProgress,
    revealSource,
  } = editor;
  const handleEditorViewportChange = useCallback(
    (slotId: string, offset: number) => {
      if (!isActiveEditor(slotId)) return;
      if (previewDrivenScroll.current) {
        previewDrivenScroll.current = false;
      } else {
        onPreviewSyncChange(offset);
      }
    },
    [isActiveEditor, onPreviewSyncChange, previewDrivenScroll],
  );
  const handlePreviewSelectionChange = useCallback(
    (selection: ScreenplaySourceSelection) => {
      const view = getActiveView();
      if (!view) return;
      const clampedSelection = clampScreenplaySourceSelection(selection, view.state.doc.length);
      previewSelectionInProgress.current = true;
      onSourceSelectionChange(clampedSelection);
      onCursorChange(clampedSelection.head);
      previewDrivenScroll.current = true;
      view.dispatch({
        selection: { anchor: clampedSelection.anchor, head: clampedSelection.head },
        effects: EditorView.scrollIntoView(clampedSelection.head, { y: 'center' }),
      });
    },
    [
      getActiveView,
      onCursorChange,
      onSourceSelectionChange,
      previewDrivenScroll,
      previewSelectionInProgress,
    ],
  );
  const handlePreviewOffsetChange = useCallback(
    (offset: number) => {
      if (previewSelectionInProgress.current) {
        previewSelectionInProgress.current = false;
        return;
      }
      previewDrivenScroll.current = true;
      revealSource(offset);
    },
    [previewDrivenScroll, previewSelectionInProgress, revealSource],
  );
  const replacePanel = (slotId: string, panel: ScreenplayPanel) => {
    layout.onChange(
      reduceScreenplayPanelLayout(layout.value, {
        type: 'replace',
        slotId,
        panel,
      }),
    );
  };

  return (
    <section className={styles.workspace} aria-label="Screenplay workspace">
      <ScreenplayWorkspaceShell
        layout={layout.value}
        activeSlotId={layout.activeSlotId}
        onActiveSlotChange={layout.onActiveSlotChange}
        className={styles.screenplayShell}
        fullscreenSlotId={layout.fullscreenSlotId}
        onFullscreenSlotChange={layout.onFullscreenChange}
        canUndo={layout.canUndo}
        onUndo={layout.onUndo}
        onLayoutChange={layout.onChange}
        onOperationError={(error) => actions.reportError(error.message)}
        toolbarStart={zenMode ? undefined : <ScreenplayStatusBar document={document} />}
        renderPanelToolbar={(context) => (
          <ScreenplayPanelToolbar {...context} onReplacePanel={replacePanel} />
        )}
        renderPanelCommands={({ panel, slotId }) =>
          panel.type === 'editor' ? (
            <Tooltip content="Enter distraction-free Zen mode">
              <button
                type="button"
                className={styles.zenPanelButton}
                aria-label="Enter Zen mode"
                onClick={() => actions.toggleZen(slotId)}
              >
                <FlowerLotusIcon size={14} weight="bold" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : undefined
        }
        renderPanelMenuItems={({ panel, slotId }) =>
          panel.type === 'editor'
            ? [{ label: 'Enter Zen mode', action: () => actions.toggleZen(slotId) }]
            : panel.type === 'preview'
              ? [{ label: 'Export PDF…', action: actions.exportPdf }]
              : panel.type === 'outline'
                ? [
                    {
                      label: 'Clear outline filter',
                      disabled: !panel.config.search,
                      action: () =>
                        replacePanel(slotId, {
                          ...panel,
                          config: { ...panel.config, search: '' },
                        }),
                    },
                  ]
                : []
        }
        renderPanel={({ panel, slotId }) => {
          if (panel.type === 'outline') {
            return (
              <OutlinePanel
                scenes={document.visibleScenes}
                activeSceneId={document.activeScene?.id}
                filter={panel.config.search}
                metadata={panel.config.metadata}
                sceneMetadata={sceneMetadata}
                onSelect={(scene) => {
                  document.onCursorChange(scene.sourceStart);
                  document.onPreviewSyncChange(scene.sourceStart);
                  editor.revealSource(scene.sourceStart, true);
                }}
              />
            );
          }
          if (panel.type === 'editor') {
            return (
              <div className={styles.editorPanel} data-editor-slot={slotId}>
                <FountainEditor
                  value={document.draft}
                  onChange={document.onDraftChange}
                  onSave={document.onSave}
                  onReady={(view) => editor.onReady(slotId, view)}
                  onSelectionChange={(offset) => {
                    if (editor.isActive(slotId)) document.onCursorChange(offset);
                  }}
                  onSourceSelectionChange={(selection) => {
                    if (editor.isActive(slotId)) document.onSourceSelectionChange(selection);
                  }}
                  paperSize={document.paperSize}
                  previewModel={document.previewModel}
                  showLineNumbers={!zenMode && panel.config.showLineNumbers}
                  showPageBreaks={panel.config.showPageBreaks}
                  typewriterScrollingEnabled={panel.config.typewriterScrolling}
                  focusModeEnabled={panel.config.focusMode}
                  focusModeScope={panel.config.focusScope}
                  onViewportChange={(offset) => handleEditorViewportChange(slotId, offset)}
                />
              </div>
            );
          }
          if (panel.type === 'inventory') {
            return (
              <InventoryPanel
                model={document.contextModel}
                view={panel.config.view}
                search={panel.config.search}
                onReveal={(offset) => {
                  document.onCursorChange(offset);
                  document.onPreviewSyncChange(offset);
                  editor.revealSource(offset, true);
                }}
              />
            );
          }
          if (panel.type === 'statistics') {
            return (
              <Suspense fallback={<div className={styles.panelLoading}>Analyzing screenplay…</div>}>
                <ScreenplayStatisticsPanel
                  model={document.statisticsModel}
                  view={panel.config.view}
                  onReveal={(offset) => {
                    document.onCursorChange(offset);
                    document.onPreviewSyncChange(offset);
                    editor.revealSource(offset, true);
                  }}
                />
              </Suspense>
            );
          }
          const previewSelection = clampScreenplaySourceSelection(
            document.sourceSelection,
            document.analysisDraft.length,
          );
          return (
            <div className={styles.previewPanel}>
              <ScreenplayPreview
                source={document.analysisDraft}
                model={document.previewModel}
                paperSize={document.paperSize}
                zoom={screenplayPreviewZoom(panel)}
                pageView={panel.config.pageView}
                scrollSync={panel.config.scrollSync}
                activeSourceOffset={
                  panel.config.scrollSync
                    ? clampScreenplaySourceOffset(
                        document.previewSyncOffset,
                        document.analysisDraft.length,
                      )
                    : undefined
                }
                activeSourceSelection={previewSelection}
                onSourceSelectionChange={handlePreviewSelectionChange}
                onSourceOffsetChange={
                  panel.config.scrollSync ? handlePreviewOffsetChange : undefined
                }
              />
            </div>
          );
        }}
      />
    </section>
  );
}
