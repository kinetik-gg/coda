import { redo, selectAll, undo } from '@codemirror/commands';
import {
  SearchQuery,
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from '@codemirror/search';
import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type {
  ScreenplayCommandTarget,
  ScreenplaySearchMode,
  ScreenplaySearchState,
} from './screenplay-commands';

export function createCodeMirrorCommandTarget(view: EditorView): ScreenplayCommandTarget {
  let searchConfigured = false;
  let fontSizePx = 16;
  let zoomPercent = 100;
  const applyDisplayScale = () => {
    const effectiveSize = (fontSizePx * zoomPercent) / 100;
    view.dom.style.setProperty('--screenplay-effective-font-size', `${String(effectiveSize)}px`);
    view.dom.dataset.fontSizePx = String(fontSizePx);
    view.dom.dataset.zoomPercent = String(zoomPercent);
    view.requestMeasure();
  };
  const ensureSearch = () => {
    if (searchConfigured) return;
    view.dispatch({ effects: StateEffect.appendConfig.of(search()) });
    searchConfigured = true;
  };

  return {
    undo: () => undo(view),
    redo: () => redo(view),
    selectedText: () => {
      const selection = view.state.selection.main;
      return view.state.sliceDoc(selection.from, selection.to);
    },
    replaceSelection: (text) => {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
      return true;
    },
    deleteSelection: () => {
      const selection = view.state.selection.main;
      if (selection.empty) return false;
      view.dispatch({ changes: { from: selection.from, to: selection.to } });
      view.focus();
      return true;
    },
    selectAll: () => selectAll(view),
    setSearch: (search: Omit<ScreenplaySearchState, 'mode'>) => {
      ensureSearch();
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: search.query,
            replace: search.replacement,
            caseSensitive: search.matchCase,
          }),
        ),
      });
    },
    openSearch: (mode: Exclude<ScreenplaySearchMode, 'closed'>) => {
      void mode;
      return openSearchPanel(view);
    },
    findNext: () => findNext(view),
    findPrevious: () => findPrevious(view),
    replaceNext: () => replaceNext(view),
    replaceAll: () => replaceAll(view),
    setGrammarCheck: (enabled) => {
      view.contentDOM.spellcheck = enabled;
      view.contentDOM.setAttribute('autocorrect', enabled ? 'on' : 'off');
    },
    setZoomPercent: (percent) => {
      zoomPercent = percent;
      applyDisplayScale();
    },
    setFontSizePx: (size) => {
      fontSizePx = size;
      applyDisplayScale();
    },
    focus: () => view.focus(),
  };
}
