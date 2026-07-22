import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EditorView } from '@codemirror/view';
import { api } from '../api';
import { collectPanelSlots } from '../workspace/layout';
import { createCodeMirrorCommandTarget } from './codemirror-command-target';
import { downloadFountain } from './fountain-download';
import { ScreenplayEditorWorkspace } from './ScreenplayEditorWorkspace';
import { ScreenplayRecoveryNotice } from './ScreenplayRecoveryNotice';
import { ScreenplayZenControls } from './ScreenplayZenControls';
import { createScreenplayCommandController, type ScreenplayCommandId } from './screenplay-commands';
import { applyFountainFormat, type FountainFormatCommand } from './screenplay-formatting';
import type { ScreenplayPaperSize } from './screenplay-paper';
import { ScreenplayMenuBar, type ScreenplayMenuBarProps } from './ScreenplayMenuBar';
import {
  reduceScreenplayPanelLayout,
  type ScreenplayPanel,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';
import type { ScreenplaySourceSelection } from './screenplay-preview-model';
import type { SaveStatus, Screenplay } from './types';
import { useScreenplayAnalysis as useDerivedScreenplayAnalysis } from './useScreenplayAnalysis';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { useScreenplayCheckpointExports } from './useScreenplayCheckpointExports';
import { useScreenplayPanelLayout } from './useScreenplayPanelLayout';
import { useScreenplayShortcuts } from './useScreenplayShortcuts';
import styles from './ScreenplayEditorScreen.module.css';

type EditorPanel = Extract<ScreenplayPanel, { type: 'editor' }>;
type ScreenplayPanelSlot = ReturnType<typeof collectPanelSlots<ScreenplayPanel>>[number];
const collapsedSourceSelection: ScreenplaySourceSelection = { anchor: 0, head: 0, from: 0, to: 0 };

function useScreenplayAnalysis(
  draft: string,
  paperSize: ScreenplayPaperSize,
  cursorSourceOffset: number,
  editorView: RefObject<EditorView | undefined>,
) {
  const analysis = useDerivedScreenplayAnalysis(draft, paperSize);
  const { analysisDraft, contextModel, previewModel, statisticsModel, wordCount } = analysis;
  const activeScene = useMemo(() => {
    for (let index = previewModel.scenes.length - 1; index >= 0; index -= 1) {
      const scene = previewModel.scenes[index];
      if (scene && scene.sourceStart <= cursorSourceOffset) return scene;
    }
    return undefined;
  }, [cursorSourceOffset, previewModel.scenes]);
  const currentLine =
    editorView.current?.state.doc.lineAt(
      Math.min(cursorSourceOffset, editorView.current.state.doc.length),
    ).number ?? 1;
  return {
    activeScene,
    analysisDraft,
    contextModel,
    currentLine,
    previewModel,
    statisticsModel,
    visibleScenes: previewModel.scenes,
    wordCount,
  };
}

function useEditorLineNumbers(
  panelLayout: ScreenplayPanelLayout,
  editorSlots: ReturnType<typeof collectPanelSlots<ScreenplayPanel>>,
  commitPanelLayout: (layout: ScreenplayPanelLayout) => void,
) {
  const showLineNumbers = editorSlots.every(
    (slot) => slot.panel.type !== 'editor' || slot.panel.config.showLineNumbers,
  );
  const toggleLineNumbers = useCallback(() => {
    if (!editorSlots.length) return;
    let nextLayout = panelLayout;
    for (const slot of editorSlots) {
      if (slot.panel.type !== 'editor') continue;
      nextLayout = reduceScreenplayPanelLayout(nextLayout, {
        type: 'replace',
        slotId: slot.id,
        panel: {
          ...slot.panel,
          config: {
            ...slot.panel.config,
            showLineNumbers: !showLineNumbers,
          },
        },
      });
    }
    commitPanelLayout(nextLayout);
  }, [commitPanelLayout, editorSlots, panelLayout, showLineNumbers]);
  return { showLineNumbers, toggleLineNumbers };
}

function useEditorPageBreaks(
  panelLayout: ScreenplayPanelLayout,
  editorSlots: ReturnType<typeof collectPanelSlots<ScreenplayPanel>>,
  commitPanelLayout: (layout: ScreenplayPanelLayout) => void,
) {
  const showPageBreaks = editorSlots.every(
    (slot) => slot.panel.type !== 'editor' || slot.panel.config.showPageBreaks,
  );
  const togglePageBreaks = useCallback(() => {
    if (!editorSlots.length) return;
    let nextLayout = panelLayout;
    for (const slot of editorSlots) {
      if (slot.panel.type !== 'editor') continue;
      nextLayout = reduceScreenplayPanelLayout(nextLayout, {
        type: 'replace',
        slotId: slot.id,
        panel: {
          ...slot.panel,
          config: { ...slot.panel.config, showPageBreaks: !showPageBreaks },
        },
      });
    }
    commitPanelLayout(nextLayout);
  }, [commitPanelLayout, editorSlots, panelLayout, showPageBreaks]);
  return { showPageBreaks, togglePageBreaks };
}

function useEditorDisplaySettings(
  panelLayout: ScreenplayPanelLayout,
  editorSlots: ReturnType<typeof collectPanelSlots<ScreenplayPanel>>,
  commitPanelLayout: (layout: ScreenplayPanelLayout) => void,
) {
  const lineNumbers = useEditorLineNumbers(panelLayout, editorSlots, commitPanelLayout);
  const pageBreaks = useEditorPageBreaks(panelLayout, editorSlots, commitPanelLayout);
  return { ...lineNumbers, ...pageBreaks };
}

function useZenEditorViewSettings(
  panelLayout: ScreenplayPanelLayout,
  editorSlot: ScreenplayPanelSlot | undefined,
  commitPanelLayout: (layout: ScreenplayPanelLayout) => void,
) {
  const editorPanel = editorSlot?.panel.type === 'editor' ? editorSlot.panel : undefined;
  const update = useCallback(
    (changes: Partial<EditorPanel['config']>) => {
      if (!editorSlot || !editorPanel) return;
      commitPanelLayout(
        reduceScreenplayPanelLayout(panelLayout, {
          type: 'replace',
          slotId: editorSlot.id,
          panel: {
            ...editorPanel,
            config: { ...editorPanel.config, ...changes },
          },
        }),
      );
    },
    [commitPanelLayout, editorPanel, editorSlot, panelLayout],
  );
  const toggleTypewriter = useCallback(() => {
    if (editorPanel) update({ typewriterScrolling: !editorPanel.config.typewriterScrolling });
  }, [editorPanel, update]);
  const cycleFocus = useCallback(() => {
    if (!editorPanel) return;
    if (!editorPanel.config.focusMode) return update({ focusMode: true, focusScope: 'paragraph' });
    if (editorPanel.config.focusScope === 'paragraph') {
      return update({ focusMode: true, focusScope: 'line' });
    }
    update({ focusMode: false });
  }, [editorPanel, update]);
  return { cycleFocus, editorPanel, toggleTypewriter, update };
}

function EditorNotice({
  status,
  operationError,
  onDismiss,
  onReload,
  onRetry,
}: {
  status: SaveStatus;
  operationError?: string;
  onDismiss: () => void;
  onReload: () => void;
  onRetry: () => void;
}) {
  if (status !== 'conflict' && status !== 'failed' && !operationError) return null;
  const message =
    operationError ??
    (status === 'conflict'
      ? 'Another session saved a newer version. Your local draft is still here.'
      : 'Coda could not save this draft. Your text remains in the editor.');
  return (
    <aside className={styles.toast} role="alert">
      <span>{message}</span>
      <button
        type="button"
        onClick={operationError ? onDismiss : status === 'conflict' ? onReload : onRetry}
      >
        {operationError ? 'Dismiss' : status === 'conflict' ? 'Reload latest' : 'Try again'}
      </button>
    </aside>
  );
}

function EditorRecovery({
  autosave,
  filename,
}: {
  autosave: ReturnType<typeof useScreenplayAutosave>;
  filename: string;
}) {
  return (
    <ScreenplayRecoveryNotice
      recovery={autosave.recovery}
      storageError={autosave.recoveryError}
      serverVersion={autosave.recoveryServerVersion}
      onRecover={autosave.recoverDraft}
      onDownload={() => downloadFountain(filename, autosave.recovery?.sourceText ?? autosave.draft)}
      onDiscard={() => void autosave.discardRecovery()}
      onDismissError={autosave.dismissRecoveryError}
    />
  );
}

function ScreenplayEditor({
  screenplayId,
  screenplay,
  onBack,
}: {
  screenplayId: string;
  screenplay: Screenplay;
  onBack: () => void;
}) {
  const autosave = useScreenplayAutosave(screenplayId, screenplay);
  const editorView = useRef<EditorView | undefined>(undefined);
  const previewDrivenScroll = useRef(false);
  const previewSelectionInProgress = useRef(false);
  const [controller] = useState(() => createScreenplayCommandController());
  const getCommandState = useCallback(() => controller.getState(), [controller]);
  const commandState = useSyncExternalStore(
    useCallback((notify) => controller.subscribe(() => notify()), [controller]),
    getCommandState,
    getCommandState,
  );
  const [operationError, setOperationError] = useState<string>();
  const {
    layout: panelLayout,
    fullscreenSlotId,
    canUndo: canUndoPanelLayout,
    setFullscreenSlotId,
    commit: commitPanelLayout,
    undo: undoPanelLayout,
    reset: resetPanelLayout,
  } = useScreenplayPanelLayout({ screenplayId, onError: setOperationError });
  const [zenMode, setZenMode] = useState(false);
  const [cursorSourceOffset, setCursorSourceOffset] = useState(0);
  const [sourceSelection, setSourceSelection] = useState(collapsedSourceSelection);
  const [previewSyncOffset, setPreviewSyncOffset] = useState(0);
  const panelSlots = useMemo(() => collectPanelSlots(panelLayout.root), [panelLayout.root]);
  const {
    activeScene,
    analysisDraft,
    contextModel,
    currentLine,
    previewModel,
    statisticsModel,
    visibleScenes,
    wordCount,
  } = useScreenplayAnalysis(autosave.draft, autosave.paperSize, cursorSourceOffset, editorView);
  const editorSlot = panelSlots.find((slot) => slot.panel.type === 'editor');
  const editorSlots = useMemo(
    () => panelSlots.filter((slot) => slot.panel.type === 'editor'),
    [panelSlots],
  );
  const editorSlotId = editorSlot?.id;
  const editorDisplay = useEditorDisplaySettings(panelLayout, editorSlots, commitPanelLayout);
  const {
    cycleFocus,
    editorPanel,
    toggleTypewriter,
    update: updateEditorViewSettings,
  } = useZenEditorViewSettings(panelLayout, editorSlot, commitPanelLayout);
  const leave = useCallback(async () => {
    if (await autosave.persist()) onBack();
  }, [autosave, onBack]);
  const attachEditor = useCallback(
    (view: EditorView | undefined) => {
      editorView.current = view;
      controller.setTarget(view ? createCodeMirrorCommandTarget(view) : undefined);
    },
    [controller],
  );
  const revealSource = useCallback((sourceOffset: number, focus = false) => {
    const view = editorView.current;
    if (!view) return;
    const offset = Math.min(Math.max(0, sourceOffset), view.state.doc.length);
    if (focus) {
      view.focus();
      view.dispatch({ selection: { anchor: offset } });
      view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(offset).top - 40);
      view.requestMeasure();
      return;
    }
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(offset).top - 40);
    view.requestMeasure();
  }, []);
  const runCommand = useCallback(
    (id: ScreenplayCommandId) => {
      void controller.execute(id).then((result) => {
        if (result.status === 'failed')
          setOperationError('The editing command could not be completed.');
        if (result.status === 'unsupported') {
          setOperationError('This browser did not grant access to that editing command.');
        }
      });
    },
    [controller],
  );
  const format = useCallback((command: FountainFormatCommand) => {
    const view = editorView.current;
    if (view) applyFountainFormat(view, command);
  }, []);
  const toggleZen = useCallback(() => {
    if (!editorSlotId) {
      setOperationError('Add an Editor panel before entering Zen mode.');
      return;
    }
    setZenMode((current) => {
      const next = !current;
      setFullscreenSlotId(next ? editorSlotId : null);
      return next;
    });
  }, [editorSlotId, setFullscreenSlotId]);
  const exitZen = useCallback(() => {
    setZenMode(false);
    setFullscreenSlotId(null);
  }, [setFullscreenSlotId]);
  const { exportFountain, exportFinalDraft, exportPdf } = useScreenplayCheckpointExports({
    screenplayId,
    persist: autosave.persist,
    getCurrentDocument: autosave.getCurrentDocument,
    getCurrentVersion: autosave.getCurrentVersion,
    reportError: setOperationError,
  });
  useEffect(() => () => controller.dispose(), [controller]);
  useScreenplayShortcuts({
    editorView,
    zenMode,
    onExitZen: exitZen,
    onToggleZen: toggleZen,
    onToggleTypewriter: toggleTypewriter,
    onCycleFocus: cycleFocus,
    onFormat: format,
    onExportPdf: exportPdf,
  });

  const menuProps: ScreenplayMenuBarProps = {
    title: screenplay.title,
    filename: screenplay.filename,
    commandState,
    paperSize: autosave.paperSize,
    onBack: () => void leave(),
    onSave: () => void autosave.persist(),
    onDownload: exportFountain,
    onExportPdf: exportPdf,
    onExportFinalDraft: exportFinalDraft,
    onCommand: runCommand,
    onFormat: format,
    onToggleZen: toggleZen,
    showLineNumbers: editorDisplay.showLineNumbers,
    onToggleLineNumbers: editorDisplay.toggleLineNumbers,
    showPageBreaks: editorDisplay.showPageBreaks,
    onTogglePageBreaks: editorDisplay.togglePageBreaks,
    onPaperSizeChange: autosave.setPaperSize,
    onResetLayout: resetPanelLayout,
  };

  return (
    <main className={`${styles.screen} ${zenMode ? styles.zen : ''}`}>
      {!zenMode && <ScreenplayMenuBar {...menuProps} />}
      {zenMode && editorPanel && (
        <ScreenplayZenControls
          typewriterScrolling={editorPanel.config.typewriterScrolling}
          focusMode={editorPanel.config.focusMode}
          focusScope={editorPanel.config.focusScope}
          onTypewriterChange={(enabled) =>
            updateEditorViewSettings({ typewriterScrolling: enabled })
          }
          onFocusChange={(mode) =>
            updateEditorViewSettings(
              mode === 'off' ? { focusMode: false } : { focusMode: true, focusScope: mode },
            )
          }
          onExit={exitZen}
        />
      )}
      <ScreenplayEditorWorkspace
        zenMode={zenMode}
        layout={{
          value: panelLayout,
          fullscreenSlotId,
          canUndo: canUndoPanelLayout,
          onUndo: undoPanelLayout,
          onChange: commitPanelLayout,
          onFullscreenChange: setFullscreenSlotId,
        }}
        document={{
          draft: autosave.draft,
          analysisDraft,
          paperSize: autosave.paperSize,
          saveStatus: autosave.status,
          previewModel,
          contextModel,
          statisticsModel,
          visibleScenes,
          activeScene,
          wordCount,
          currentLine,
          commandState,
          sourceSelection,
          previewSyncOffset,
          onDraftChange: autosave.setDraft,
          onSave: autosave.persist,
          onCursorChange: setCursorSourceOffset,
          onSourceSelectionChange: setSourceSelection,
          onPreviewSyncChange: setPreviewSyncOffset,
        }}
        editor={{
          view: editorView,
          previewDrivenScroll,
          previewSelectionInProgress,
          onReady: attachEditor,
          revealSource,
        }}
        actions={{
          toggleZen,
          exportPdf,
          reportError: setOperationError,
        }}
      />
      <EditorNotice
        status={autosave.status}
        operationError={operationError}
        onDismiss={() => setOperationError(undefined)}
        onReload={() => void autosave.reloadLatest()}
        onRetry={() => void autosave.persist()}
      />
      <EditorRecovery autosave={autosave} filename={screenplay.filename} />
    </main>
  );
}

export function ScreenplayEditorScreen({
  screenplayId,
  onBack,
}: {
  screenplayId: string;
  onBack: () => void;
}) {
  const screenplay = useQuery({
    queryKey: ['screenplay', screenplayId],
    queryFn: () => api<Screenplay>(`/api/v1/screenplays/${screenplayId}`),
  });
  if (screenplay.isLoading) return <main className={styles.state}>Opening screenplay…</main>;
  if (!screenplay.data) {
    return (
      <main className={styles.state} role="alert">
        <strong>Screenplay could not be opened.</strong>
        <button type="button" onClick={onBack}>
          Back to screenplays
        </button>
      </main>
    );
  }
  return (
    <ScreenplayEditor screenplayId={screenplayId} screenplay={screenplay.data} onBack={onBack} />
  );
}
