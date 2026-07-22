import type { EditorState, Extension, Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

const TYPEWRITER_VIEWPORT_POSITION = 0.4;
const TYPEWRITER_VIEWPORT_MIN = 0.35;
const TYPEWRITER_VIEWPORT_MAX = 0.45;
const typewriterMeasureKey = {};

interface ParagraphBounds {
  fromLine: number;
  toLine: number;
}

function paragraphBounds(state: EditorState): ParagraphBounds {
  const activeLine = state.doc.lineAt(state.selection.main.head);
  if (activeLine.text.trim().length === 0) {
    return { fromLine: activeLine.number, toLine: activeLine.number };
  }

  let fromLine = activeLine.number;
  while (fromLine > 1 && state.doc.line(fromLine - 1).text.trim().length > 0) {
    fromLine -= 1;
  }

  let toLine = activeLine.number;
  while (toLine < state.doc.lines && state.doc.line(toLine + 1).text.trim().length > 0) {
    toLine += 1;
  }

  return { fromLine, toLine };
}

function focusDecorations(
  state: EditorState,
  bounds: ParagraphBounds,
  activeLine: number,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (let lineNumber = bounds.fromLine; lineNumber <= bounds.toLine; lineNumber += 1) {
    ranges.push(
      Decoration.line({
        class:
          lineNumber === activeLine
            ? 'cm-fountain-focus-paragraph cm-fountain-focus-line'
            : 'cm-fountain-focus-paragraph',
      }).range(state.doc.line(lineNumber).from),
    );
  }
  return Decoration.set(ranges);
}

/**
 * Marks only the active blank-line-delimited Fountain block. CSS decides
 * whether the marks are visible, so toggling Focus Mode does not rebuild the
 * editor or reparse the screenplay.
 */
export const fountainFocusParagraph: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private bounds: ParagraphBounds;
    private activeLine: number;

    constructor(view: EditorView) {
      this.activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      this.bounds = paragraphBounds(view.state);
      this.decorations = focusDecorations(view.state, this.bounds, this.activeLine);
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet) return;
      const activeLine = update.state.doc.lineAt(update.state.selection.main.head).number;
      if (!update.docChanged && activeLine === this.activeLine) return;
      const nextBounds = paragraphBounds(update.state);
      this.activeLine = activeLine;
      this.bounds = nextBounds;
      this.decorations = focusDecorations(update.state, nextBounds, activeLine);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function typewriterScrollDelta(
  caretTop: number,
  viewportTop: number,
  viewportHeight: number,
): number {
  const relativePosition = (caretTop - viewportTop) / viewportHeight;
  if (relativePosition >= TYPEWRITER_VIEWPORT_MIN && relativePosition <= TYPEWRITER_VIEWPORT_MAX) {
    return 0;
  }
  return caretTop - (viewportTop + viewportHeight * TYPEWRITER_VIEWPORT_POSITION);
}

/**
 * Coalesces typewriter-scroll layout work into CodeMirror's measure cycle.
 * The caret is kept at 40% of the visible editor height without touching the
 * horizontal scroll position or dispatching another editor transaction.
 */
export function scheduleTypewriterAlignment(view: EditorView): void {
  view.requestMeasure({
    key: typewriterMeasureKey,
    read(measuredView) {
      const caret = measuredView.coordsAtPos(measuredView.state.selection.main.head);
      if (!caret) return undefined;
      const viewport = measuredView.scrollDOM.getBoundingClientRect();
      return typewriterScrollDelta(caret.top, viewport.top, viewport.height);
    },
    write(delta, measuredView) {
      if (delta === undefined || Math.abs(delta) < 1) return;
      const top = measuredView.scrollDOM.scrollTop + delta;
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion || typeof measuredView.scrollDOM.scrollTo !== 'function') {
        measuredView.scrollDOM.scrollTop = top;
        return;
      }
      measuredView.scrollDOM.scrollTo({ top, behavior: 'smooth' });
    },
  });
}
