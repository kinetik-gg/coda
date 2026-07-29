import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { fountainFocusParagraph, scheduleTypewriterAlignment } from './fountain-editor-ergonomics';
import { fountainSyntax, remoteCollaborationTransaction } from './fountain-syntax';
import {
  screenplayCollaborationExtensions,
  type ScreenplayCollaborationBinding,
} from './screenplay-collaboration-editor';
import { screenplayCollaborationText } from './screenplay-collaboration-text';
import { screenplayPaper, type ScreenplayPaperSize } from './screenplay-paper';
import type { ScreenplayPreviewModel, ScreenplaySourceSelection } from './screenplay-preview-model';
import styles from './FountainEditor.module.css';

// basicSetup installs line numbers at index 0 and document-global history at index 3. The
// collaboration binding owns both concerns: line numbers stay reconfigurable, while undo/redo is
// per-user through the shared Y.UndoManager.
const basicSetupExtensions = basicSetup as readonly Extension[];
const collaborativeEditorSetup = [
  ...basicSetupExtensions.slice(1, 3),
  ...basicSetupExtensions.slice(4),
];

function topVisibleSourceOffset(view: EditorView): number {
  const viewport = view.scrollDOM.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  return (
    view.posAtCoords(
      { x: Math.min(content.right - 1, content.left + 1), y: viewport.top + 1 },
      false,
    ) ?? view.viewport.from
  );
}

function FountainEditorComponent({
  collaboration,
  onSave,
  onReady,
  registrationKey,
  onViewportChange,
  onSelectionChange,
  onSourceSelectionChange,
  fontSizePx = 16,
  grammarCheckEnabled = false,
  paperSize = 'letter',
  previewModel,
  showLineNumbers = true,
  showPageBreaks = true,
  typewriterScrollingEnabled = false,
  focusModeEnabled = false,
  focusModeScope = 'paragraph',
  readOnly = false,
}: {
  collaboration: ScreenplayCollaborationBinding;
  onSave: () => void;
  onReady?: (view: EditorView | undefined) => void;
  /** Re-publishes the mounted view when its owning workspace slot identity changes. */
  registrationKey?: string;
  onViewportChange?: (sourceOffset: number) => void;
  onSelectionChange?: (sourceOffset: number) => void;
  onSourceSelectionChange?: (selection: ScreenplaySourceSelection) => void;
  fontSizePx?: number;
  grammarCheckEnabled?: boolean;
  paperSize?: ScreenplayPaperSize;
  previewModel?: ScreenplayPreviewModel;
  showLineNumbers?: boolean;
  showPageBreaks?: boolean;
  typewriterScrollingEnabled?: boolean;
  focusModeEnabled?: boolean;
  focusModeScope?: 'paragraph' | 'line';
  readOnly?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const grammarCheck = useRef(new Compartment());
  const lineNumberGutter = useRef(new Compartment());
  const syntax = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const paperSizeRef = useRef(paperSize);
  const previewModelRef = useRef(previewModel);
  const showLineNumbersRef = useRef(showLineNumbers);
  const readOnlyRef = useRef(readOnly);
  const typewriterScrollingEnabledRef = useRef(typewriterScrollingEnabled);
  const onSaveRef = useRef(onSave);
  const onReadyRef = useRef(onReady);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSourceSelectionChangeRef = useRef(onSourceSelectionChange);
  onSaveRef.current = onSave;
  onReadyRef.current = onReady;
  onViewportChangeRef.current = onViewportChange;
  onSelectionChangeRef.current = onSelectionChange;
  onSourceSelectionChangeRef.current = onSourceSelectionChange;
  typewriterScrollingEnabledRef.current = typewriterScrollingEnabled;
  paperSizeRef.current = paperSize;
  previewModelRef.current = previewModel;
  showLineNumbersRef.current = showLineNumbers;
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: screenplayCollaborationText(collaboration.text),
        extensions: [
          collaborativeEditorSetup,
          screenplayCollaborationExtensions(collaboration),
          EditorView.lineWrapping,
          grammarCheck.current.of(EditorView.contentAttributes.of({ spellcheck: 'false' })),
          lineNumberGutter.current.of(showLineNumbersRef.current ? lineNumbers() : []),
          editable.current.of(
            readOnlyRef.current
              ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
              : [],
          ),
          syntax.current.of(fountainSyntax(paperSizeRef.current, previewModelRef.current)),
          fountainFocusParagraph,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            const externalUpdate = update.transactions.some(
              (transaction) => transaction.annotation(remoteCollaborationTransaction) === true,
            );
            if (update.viewportChanged && !externalUpdate) {
              onViewportChangeRef.current?.(topVisibleSourceOffset(update.view));
            }
            if (update.docChanged || update.selectionSet) {
              const selection = update.state.selection.main;
              onSelectionChangeRef.current?.(selection.head);
              onSourceSelectionChangeRef.current?.({
                anchor: selection.anchor,
                head: selection.head,
                from: selection.from,
                to: selection.to,
              });
              if (typewriterScrollingEnabledRef.current && !externalUpdate) {
                scheduleTypewriterAlignment(update.view);
              }
            }
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    onReadyRef.current?.(view);
    onViewportChangeRef.current?.(topVisibleSourceOffset(view));
    const selection = view.state.selection.main;
    onSelectionChangeRef.current?.(selection.head);
    onSourceSelectionChangeRef.current?.({
      anchor: selection.anchor,
      head: selection.head,
      from: selection.from,
      to: selection.to,
    });
    return () => {
      onReadyRef.current?.(undefined);
      view.destroy();
      viewRef.current = undefined;
    };
  }, [collaboration]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const publishReady = onReadyRef.current;
    publishReady?.(view);
    return () => publishReady?.(undefined);
  }, [registrationKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: grammarCheck.current.reconfigure(
        EditorView.contentAttributes.of({ spellcheck: String(grammarCheckEnabled) }),
      ),
    });
  }, [grammarCheckEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineNumberGutter.current.reconfigure(showLineNumbers ? lineNumbers() : []),
    });
  }, [showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editable.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !typewriterScrollingEnabled) return;
    scheduleTypewriterAlignment(view);
  }, [typewriterScrollingEnabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: syntax.current.reconfigure(fountainSyntax(paperSize, previewModel)),
    });
  }, [paperSize, previewModel]);

  const paper = screenplayPaper(paperSize);

  return (
    <div
      ref={hostRef}
      className={`${styles.editor} fountain-editor-host`}
      aria-label="Screenplay editor"
      data-show-line-numbers={showLineNumbers ? 'true' : 'false'}
      data-show-page-breaks={showPageBreaks ? 'true' : 'false'}
      data-focus-mode={focusModeEnabled ? 'true' : 'false'}
      data-focus-scope={focusModeScope}
      data-typewriter-scrolling={typewriterScrollingEnabled ? 'true' : 'false'}
      data-read-only={readOnly ? 'true' : 'false'}
      data-editor-columns={paper.editorColumns}
      data-min-horizontal-padding="72"
      style={
        {
          '--screenplay-editor-font-size': `${String(fontSizePx)}px`,
          '--fountain-page-width': `${String(paper.editorColumns)}ch`,
          '--fountain-half-page-width': `${String(paper.editorColumns / 2)}ch`,
        } as CSSProperties
      }
    />
  );
}

export const FountainEditor = memo(FountainEditorComponent);
