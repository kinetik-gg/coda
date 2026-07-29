import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { fountainFocusParagraph, scheduleTypewriterAlignment } from './fountain-editor-ergonomics';
import { fountainSyntax } from './fountain-syntax';
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
const editorSetupWithoutLineNumbers = Array.isArray(basicSetup) ? basicSetup.slice(1) : basicSetup;
const collaborativeEditorSetup = Array.isArray(basicSetup)
  ? [...basicSetup.slice(1, 3), ...basicSetup.slice(4)]
  : basicSetup;

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

function minimalDocumentChange(previous: string, next: string) {
  let from = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (from < sharedLength && previous.charCodeAt(from) === next.charCodeAt(from)) from += 1;

  let previousTo = previous.length;
  let nextTo = next.length;
  while (
    previousTo > from &&
    nextTo > from &&
    previous.charCodeAt(previousTo - 1) === next.charCodeAt(nextTo - 1)
  ) {
    previousTo -= 1;
    nextTo -= 1;
  }
  return { from, to: previousTo, insert: next.slice(from, nextTo) };
}

function FountainEditorComponent({
  value,
  onChange,
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
  collaboration,
}: {
  value: string;
  onChange: (value: string) => void;
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
  collaboration?: ScreenplayCollaborationBinding;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const grammarCheck = useRef(new Compartment());
  const lineNumberGutter = useRef(new Compartment());
  const syntax = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const initialValueRef = useRef(
    collaboration ? screenplayCollaborationText(collaboration.text) : value,
  );
  const initialCollaborationRef = useRef(collaboration);
  const initialPaperSizeRef = useRef(paperSize);
  const initialPreviewModelRef = useRef(previewModel);
  const initialShowLineNumbersRef = useRef(showLineNumbers);
  const initialReadOnlyRef = useRef(readOnly);
  const typewriterScrollingEnabledRef = useRef(typewriterScrollingEnabled);
  const lastEmittedValueRef = useRef(initialValueRef.current);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onReadyRef = useRef(onReady);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSourceSelectionChangeRef = useRef(onSourceSelectionChange);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onReadyRef.current = onReady;
  onViewportChangeRef.current = onViewportChange;
  onSelectionChangeRef.current = onSelectionChange;
  onSourceSelectionChangeRef.current = onSourceSelectionChange;
  typewriterScrollingEnabledRef.current = typewriterScrollingEnabled;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          initialCollaborationRef.current
            ? collaborativeEditorSetup
            : editorSetupWithoutLineNumbers,
          ...(initialCollaborationRef.current
            ? screenplayCollaborationExtensions(initialCollaborationRef.current)
            : []),
          EditorView.lineWrapping,
          grammarCheck.current.of(EditorView.contentAttributes.of({ spellcheck: 'false' })),
          lineNumberGutter.current.of(initialShowLineNumbersRef.current ? lineNumbers() : []),
          editable.current.of(
            initialReadOnlyRef.current
              ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
              : [],
          ),
          syntax.current.of(
            fountainSyntax(initialPaperSizeRef.current, initialPreviewModelRef.current),
          ),
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
            const externalUpdate =
              initialCollaborationRef.current?.isApplyingExternalUpdate() ?? false;
            if (update.docChanged) {
              const nextValue = update.state.doc.toString();
              if (nextValue !== lastEmittedValueRef.current) {
                lastEmittedValueRef.current = nextValue;
                onChangeRef.current(nextValue);
              }
            }
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
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const publishReady = onReadyRef.current;
    publishReady?.(view);
    return () => publishReady?.(undefined);
  }, [registrationKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (collaboration || !view || value === lastEmittedValueRef.current) return;
    const change = minimalDocumentChange(lastEmittedValueRef.current, value);
    lastEmittedValueRef.current = value;
    view.dispatch({ changes: change });
  }, [collaboration, value]);

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
