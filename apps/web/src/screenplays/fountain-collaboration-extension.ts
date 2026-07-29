import { EditorState, Prec, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { remoteCollaborationTransaction, revealRemoteBoneyardCarets } from './fountain-syntax';

export interface FountainCollaborationBinding {
  awareness: Awareness;
  remoteOrigin: object;
  yText: Y.Text;
}

function remoteTransactionAnnotation(binding: FountainCollaborationBinding): Extension {
  let applyingRemoteUpdate = false;
  const observer = ViewPlugin.fromClass(
    class {
      private readonly handleYText = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
        if (transaction.origin !== binding.remoteOrigin) return;
        applyingRemoteUpdate = true;
        queueMicrotask(() => {
          applyingRemoteUpdate = false;
        });
      };

      constructor() {
        binding.yText.observe(this.handleYText);
      }

      destroy(): void {
        binding.yText.unobserve(this.handleYText);
      }
    },
  );
  return [
    // This observer must initialize before y-codemirror's observer. It marks the synchronous
    // CodeMirror dispatch that y-codemirror performs later in the same Y.Text observer pass.
    Prec.highest(observer),
    EditorState.transactionExtender.of(() =>
      applyingRemoteUpdate ? { annotations: remoteCollaborationTransaction.of(true) } : null,
    ),
  ];
}

function revealRemoteCaretBoneyards(binding: FountainCollaborationBinding): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;
      private revealScheduled = false;
      private readonly handleAwareness = () => this.scheduleReveal();

      constructor(private readonly view: EditorView) {
        binding.awareness.on('change', this.handleAwareness);
        this.scheduleReveal();
      }

      destroy(): void {
        this.destroyed = true;
        binding.awareness.off('change', this.handleAwareness);
      }

      private scheduleReveal(): void {
        if (this.revealScheduled) return;
        this.revealScheduled = true;
        queueMicrotask(() => {
          this.revealScheduled = false;
          if (!this.destroyed) this.reveal();
        });
      }

      private reveal(): void {
        const offsets = [...binding.awareness.getStates()].flatMap(([clientId, state]) => {
          if (clientId === binding.awareness.doc.clientID) return [];
          const cursor = Reflect.get(state, 'cursor') as unknown;
          if (!cursor || typeof cursor !== 'object') return [];
          const head = Reflect.get(cursor, 'head') as Y.RelativePosition | undefined;
          if (!head) return [];
          const absolute = Y.createAbsolutePositionFromRelativePosition(head, binding.yText.doc!);
          return absolute?.type === binding.yText ? [absolute.index] : [];
        });
        if (offsets.length > 0) {
          this.view.dispatch({ effects: revealRemoteBoneyardCarets.of(offsets) });
        }
      }
    },
  );
}

function publishLocalSelection(binding: FountainCollaborationBinding): Extension {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        update(update: ViewUpdate): void {
          if (!update.selectionSet && !update.focusChanged) return;
          const localState = binding.awareness.getLocalState();
          if (!localState) return;
          const selection = update.state.selection.main;
          const anchor = Y.createRelativePositionFromTypeIndex(binding.yText, selection.anchor);
          const head = Y.createRelativePositionFromTypeIndex(binding.yText, selection.head);
          const current = Reflect.get(localState, 'cursor') as unknown;
          if (current && typeof current === 'object') {
            const currentAnchor = Reflect.get(current, 'anchor') as Y.RelativePosition | undefined;
            const currentHead = Reflect.get(current, 'head') as Y.RelativePosition | undefined;
            if (
              currentAnchor &&
              currentHead &&
              Y.compareRelativePositions(currentAnchor, anchor) &&
              Y.compareRelativePositions(currentHead, head)
            ) {
              return;
            }
          }
          binding.awareness.setLocalStateField('cursor', { anchor, head });
        }
      },
    ),
  );
}

export function fountainCollaboration(binding: FountainCollaborationBinding): Extension {
  return [
    remoteTransactionAnnotation(binding),
    // #156 replaces basicSetup history with the shared per-user UndoManager. Disable the binding's
    // private manager here so this issue does not introduce a second, conflicting undo stack.
    Prec.high(yCollab(binding.yText, binding.awareness, { undoManager: false })),
    publishLocalSelection(binding),
    revealRemoteCaretBoneyards(binding),
  ];
}
