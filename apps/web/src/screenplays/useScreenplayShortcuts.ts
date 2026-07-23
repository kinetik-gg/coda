import { useEffect, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import type { FountainFormatCommand } from './screenplay-formatting';

interface ScreenplayShortcutOptions {
  editorView: RefObject<EditorView | undefined>;
  zenMode: boolean;
  onExitZen: () => void;
  onToggleZen: () => void;
  onToggleTypewriter: () => void;
  onCycleFocus: () => void;
  onFormat: (command: FountainFormatCommand) => void;
  onExportPdf: () => void;
}

export function useScreenplayShortcuts({
  editorView,
  zenMode,
  onExitZen,
  onToggleZen,
  onToggleTypewriter,
  onCycleFocus,
  onFormat,
  onExportPdf,
}: ScreenplayShortcutOptions) {
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && zenMode) {
        event.preventDefault();
        onExitZen();
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase();
      if (zenMode && modifier && event.altKey && key === 't') {
        event.preventDefault();
        onToggleTypewriter();
        return;
      }
      if (zenMode && modifier && event.altKey && key === 'f') {
        event.preventDefault();
        onCycleFocus();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault();
        onExportPdf();
        return;
      }
      if (modifier && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        onToggleZen();
        return;
      }
      if (!modifier || !editorView.current?.dom.contains(document.activeElement)) return;
      const command = ({ b: 'bold', i: 'italic', u: 'underline' } as const)[
        event.key.toLocaleLowerCase() as 'b' | 'i' | 'u'
      ];
      if (!command) return;
      event.preventDefault();
      onFormat(command);
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [
    editorView,
    onCycleFocus,
    onExitZen,
    onExportPdf,
    onFormat,
    onToggleTypewriter,
    onToggleZen,
    zenMode,
  ]);
}
