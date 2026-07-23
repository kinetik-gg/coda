import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { createCodeMirrorCommandTarget } from './codemirror-command-target';
import type { ScreenplayCommandController } from './screenplay-commands';
import type { ScreenplaySourceSelection } from './screenplay-preview-model';

interface EditorSlot {
  id: string;
}

export function useActiveScreenplayEditors(
  editorSlots: readonly EditorSlot[],
  initialSlotId: string | undefined,
  controller: ScreenplayCommandController,
  onCursorChange: (offset: number) => void,
  onSourceSelectionChange: (selection: ScreenplaySourceSelection) => void,
) {
  const editorViews = useRef(new Map<string, EditorView>());
  const activeEditorView = useRef<EditorView | undefined>(undefined);
  const activeEditorSlotIdRef = useRef<string | undefined>(editorSlots[0]?.id);
  const [activeSlotId, setActiveSlotId] = useState(editorSlots[0]?.id ?? initialSlotId ?? '');
  const [activeEditorSlotId, setActiveEditorSlotId] = useState<string | undefined>(
    editorSlots[0]?.id,
  );
  activeEditorSlotIdRef.current = activeEditorSlotId;
  const selectActiveEditor = useCallback(
    (slotId: string) => {
      activeEditorSlotIdRef.current = slotId;
      setActiveEditorSlotId(slotId);
      const view = editorViews.current.get(slotId);
      activeEditorView.current = view;
      controller.setTarget(view ? createCodeMirrorCommandTarget(view) : undefined);
      if (view) reportSelection(view, onCursorChange, onSourceSelectionChange);
    },
    [controller, onCursorChange, onSourceSelectionChange],
  );
  const handleActiveSlotChange = useCallback(
    (slotId: string) => {
      setActiveSlotId(slotId);
      if (editorSlots.some((slot) => slot.id === slotId)) selectActiveEditor(slotId);
    },
    [editorSlots, selectActiveEditor],
  );
  const attachEditor = useCallback(
    (slotId: string, view: EditorView | undefined) => {
      if (view) editorViews.current.set(slotId, view);
      else editorViews.current.delete(slotId);
      if (activeEditorSlotIdRef.current !== slotId) return;
      activeEditorView.current = view;
      controller.setTarget(view ? createCodeMirrorCommandTarget(view) : undefined);
    },
    [controller],
  );
  useEffect(() => {
    if (editorSlots.some((slot) => slot.id === activeEditorSlotIdRef.current)) return;
    const next = editorSlots[0];
    if (next) selectActiveEditor(next.id);
    else {
      activeEditorSlotIdRef.current = undefined;
      setActiveEditorSlotId(undefined);
      activeEditorView.current = undefined;
      controller.setTarget(undefined);
    }
  }, [controller, editorSlots, selectActiveEditor]);
  return {
    activeEditorSlotId,
    activeEditorSlotIdRef,
    activeEditorView,
    activeSlotId,
    attachEditor,
    handleActiveSlotChange,
    selectActiveEditor,
  };
}

function reportSelection(
  view: EditorView,
  onCursorChange: (offset: number) => void,
  onSourceSelectionChange: (selection: ScreenplaySourceSelection) => void,
): void {
  const selection = view.state.selection.main;
  onCursorChange(selection.head);
  onSourceSelectionChange({
    anchor: selection.anchor,
    head: selection.head,
    from: selection.from,
    to: selection.to,
  });
}
