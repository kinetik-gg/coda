import { Facet, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type * as Y from 'yjs';

export interface ScreenplayCollaborationBinding {
  text: Y.Text;
  undoManager: Y.UndoManager;
  isApplyingExternalUpdate: () => boolean;
}

interface ScreenplayCollaborationCommands {
  undo: () => boolean;
  redo: () => boolean;
}

export const screenplayCollaborationCommands = Facet.define<
  ScreenplayCollaborationCommands,
  ScreenplayCollaborationCommands | undefined
>({
  combine: (commands) => commands.at(-1),
});

export function screenplayCollaborationExtensions(
  binding: ScreenplayCollaborationBinding,
): Extension {
  return [
    yCollab(binding.text, undefined, { undoManager: binding.undoManager }),
    screenplayCollaborationCommands.of({
      undo: () => binding.undoManager.undo() !== null,
      redo: () => binding.undoManager.redo() !== null,
    }),
    // basicSetup's history keymap remains in the standard setup for every non-document command.
    // This higher-precedence map owns undo/redo while the document-global history extension itself
    // is omitted in FountainEditor.
    Prec.highest(keymap.of(yUndoManagerKeymap)),
  ];
}
