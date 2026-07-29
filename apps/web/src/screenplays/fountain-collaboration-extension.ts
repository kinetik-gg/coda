import { EditorState, Prec, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { remoteCollaborationTransaction, revealRemoteBoneyardCarets } from './fountain-syntax';

export interface FountainCollaborationBinding {
  awareness: Awareness;
  isApplyingExternalUpdate: () => boolean;
  text: Y.Text;
}

function remoteTransactionAnnotation(binding: FountainCollaborationBinding): Extension {
  return EditorState.transactionExtender.of(() =>
    binding.isApplyingExternalUpdate()
      ? { annotations: remoteCollaborationTransaction.of(true) }
      : null,
  );
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
          const absolute = Y.createAbsolutePositionFromRelativePosition(head, binding.text.doc!);
          return absolute?.type === binding.text ? [absolute.index] : [];
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
          const anchor = Y.createRelativePositionFromTypeIndex(binding.text, selection.anchor);
          const head = Y.createRelativePositionFromTypeIndex(binding.text, selection.head);
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

export function fountainPresenceExtensions(binding: FountainCollaborationBinding): Extension {
  return [
    remoteTransactionAnnotation(binding),
    publishLocalSelection(binding),
    revealRemoteCaretBoneyards(binding),
  ];
}
