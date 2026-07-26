export type ScreenplayCommandId =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'
  | 'open-find'
  | 'open-replace'
  | 'find-next'
  | 'find-previous'
  | 'replace-next'
  | 'replace-all'
  | 'toggle-grammar-check'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'font-size-increase'
  | 'font-size-decrease'
  | 'font-size-reset';

export type ScreenplayCommandGroup = 'edit' | 'tools' | 'view';
export type ScreenplaySearchMode = 'closed' | 'find' | 'replace';

export interface ScreenplayCommandDefinition {
  id: ScreenplayCommandId;
  label: string;
  group: ScreenplayCommandGroup;
  shortcut?: string;
}

export const screenplayCommandDefinitions: readonly ScreenplayCommandDefinition[] = [
  { id: 'undo', label: 'Undo', group: 'edit', shortcut: 'Mod-Z' },
  { id: 'redo', label: 'Redo', group: 'edit', shortcut: 'Mod-Shift-Z' },
  { id: 'cut', label: 'Cut', group: 'edit', shortcut: 'Mod-X' },
  { id: 'copy', label: 'Copy', group: 'edit', shortcut: 'Mod-C' },
  { id: 'paste', label: 'Paste', group: 'edit', shortcut: 'Mod-V' },
  { id: 'select-all', label: 'Select All', group: 'edit', shortcut: 'Mod-A' },
  { id: 'open-find', label: 'Find', group: 'edit', shortcut: 'Mod-F' },
  { id: 'open-replace', label: 'Find and Replace', group: 'edit', shortcut: 'Mod-Alt-F' },
  { id: 'find-next', label: 'Find Next', group: 'edit', shortcut: 'Mod-G' },
  { id: 'find-previous', label: 'Find Previous', group: 'edit', shortcut: 'Mod-Shift-G' },
  { id: 'replace-next', label: 'Replace', group: 'edit' },
  { id: 'replace-all', label: 'Replace All', group: 'edit' },
  { id: 'toggle-grammar-check', label: 'Check Spelling and Grammar', group: 'tools' },
  { id: 'zoom-in', label: 'Zoom In', group: 'view', shortcut: 'Mod-Plus' },
  { id: 'zoom-out', label: 'Zoom Out', group: 'view', shortcut: 'Mod-Minus' },
  { id: 'zoom-reset', label: 'Actual Size', group: 'view', shortcut: 'Mod-0' },
  { id: 'font-size-increase', label: 'Increase Editor Font', group: 'view' },
  { id: 'font-size-decrease', label: 'Decrease Editor Font', group: 'view' },
  { id: 'font-size-reset', label: 'Reset Editor Font', group: 'view' },
] as const;

export interface ScreenplaySearchState {
  mode: ScreenplaySearchMode;
  query: string;
  replacement: string;
  matchCase: boolean;
}

export interface ScreenplayCommandState {
  grammarCheckEnabled: boolean;
  zoomPercent: number;
  fontSizePx: number;
  search: ScreenplaySearchState;
  /** Whether an editor command target (a mounted CodeMirror view) is active. */
  hasEditorTarget: boolean;
}

export interface ScreenplayCommandPayload {
  query?: string;
  replacement?: string;
  matchCase?: boolean;
}

/**
 * Outcome of a command run.
 * - `handled` / `no-op`: the command reached the editor (nothing to report).
 * - `no-search-query`: a find/replace command reached the editor, but its
 *   search panel has no usable query.
 * - `no-editor`: no CodeMirror view is registered (no editor panel, or one that
 *   has not mounted yet). Distinct from `unsupported` so the UI can point the
 *   writer at the editor instead of blaming the browser.
 * - `unsupported`: a genuinely missing platform capability (e.g. clipboard
 *   `readText` in an insecure context or Firefox).
 * - `failed`: the command threw.
 */
export type ScreenplayCommandStatus =
  'handled' | 'no-op' | 'no-search-query' | 'no-editor' | 'unsupported' | 'failed';

export interface ScreenplayCommandResult {
  status: ScreenplayCommandStatus;
  error?: unknown;
}

/**
 * Maps a command result status to a writer-facing notice, or `undefined` when
 * the outcome needs no message (`handled`/`no-op`). Kept pure and exported so
 * the runner stays a thin adapter and the mapping is unit-testable.
 */
export function screenplayCommandStatusMessage(
  status: ScreenplayCommandStatus,
): string | undefined {
  switch (status) {
    case 'no-editor':
      return 'Open a screenplay editor panel to use this command.';
    case 'no-search-query':
      return 'Enter a search query before finding or replacing text.';
    case 'unsupported':
      return 'This browser did not grant access to that editing command.';
    case 'failed':
      return 'The editing command could not be completed.';
    case 'handled':
    case 'no-op':
      return undefined;
  }
}

export interface ScreenplayCommandTarget {
  undo(this: void): boolean;
  redo(this: void): boolean;
  selectedText(this: void): string;
  replaceSelection(this: void, text: string): boolean;
  deleteSelection(this: void): boolean;
  selectAll(this: void): boolean;
  setSearch(this: void, search: Omit<ScreenplaySearchState, 'mode'>): void;
  hasSearchQuery(this: void): boolean;
  openSearch(this: void, mode: Exclude<ScreenplaySearchMode, 'closed'>): boolean;
  findNext(this: void): boolean;
  findPrevious(this: void): boolean;
  replaceNext(this: void): boolean;
  replaceAll(this: void): boolean;
  setGrammarCheck(this: void, enabled: boolean): void;
  setZoomPercent(this: void, percent: number): void;
  setFontSizePx(this: void, size: number): void;
  focus(this: void): void;
}

export interface ScreenplayClipboard {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
}

/**
 * Feature-detected clipboard capabilities, resolved once when the controller is
 * created. `read` gates Paste in the menu (the Async Clipboard `readText` is
 * absent in insecure contexts and never exposed to pages in Firefox); `write`
 * is informational — Copy/Cut fall back to `execCommand` when it is missing.
 */
export interface ScreenplayClipboardCapabilities {
  read: boolean;
  write: boolean;
}

export interface CreateScreenplayCommandControllerOptions {
  target?: ScreenplayCommandTarget;
  clipboard?: ScreenplayClipboard;
  initialState?: Partial<Omit<ScreenplayCommandState, 'search'>> & {
    search?: Partial<ScreenplaySearchState>;
  };
}

export interface ScreenplayCommandController {
  execute(
    commandId: ScreenplayCommandId,
    payload?: ScreenplayCommandPayload,
  ): Promise<ScreenplayCommandResult>;
  getState(): Readonly<ScreenplayCommandState>;
  subscribe(listener: (state: Readonly<ScreenplayCommandState>) => void): () => void;
  setTarget(target?: ScreenplayCommandTarget): void;
  /** Clipboard capabilities detected once at creation. */
  readonly capabilities: ScreenplayClipboardCapabilities;
  dispose(): void;
}

const DEFAULT_ZOOM = 100;
const DEFAULT_FONT_SIZE = 16;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 32;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function browserClipboard(): ScreenplayClipboard | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.clipboard;
}

function detectClipboardCapabilities(
  clipboard: ScreenplayClipboard | undefined,
): ScreenplayClipboardCapabilities {
  return {
    read: typeof clipboard?.readText === 'function',
    write: typeof clipboard?.writeText === 'function',
  };
}

/**
 * Insecure-context fallback for Copy/Cut when the Async Clipboard `writeText`
 * is unavailable. Focuses the editor so the DOM selection matches the editor
 * selection, then copies it through the synchronous `document.execCommand`.
 * Cut deletes deterministically through the target after a successful copy.
 */
function execCommandCopy(target: ScreenplayCommandTarget, cut: boolean): ScreenplayCommandResult {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return { status: 'unsupported' };
  }
  target.focus();
  if (!document.execCommand('copy')) return { status: 'unsupported' };
  if (cut) target.deleteSelection();
  return { status: 'handled' };
}

export function createScreenplayCommandController(
  options: CreateScreenplayCommandControllerOptions = {},
): ScreenplayCommandController {
  let target = options.target;
  let disposed = false;
  const listeners = new Set<(state: Readonly<ScreenplayCommandState>) => void>();
  const clipboard = options.clipboard ?? browserClipboard();
  const capabilities = detectClipboardCapabilities(clipboard);
  let state: ScreenplayCommandState = {
    grammarCheckEnabled: options.initialState?.grammarCheckEnabled ?? true,
    zoomPercent: clamp(options.initialState?.zoomPercent ?? DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM),
    fontSizePx: clamp(
      options.initialState?.fontSizePx ?? DEFAULT_FONT_SIZE,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
    search: {
      mode: options.initialState?.search?.mode ?? 'closed',
      query: options.initialState?.search?.query ?? '',
      replacement: options.initialState?.search?.replacement ?? '',
      matchCase: options.initialState?.search?.matchCase ?? false,
    },
    hasEditorTarget: Boolean(target),
  };

  const publish = (patch: Partial<ScreenplayCommandState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };

  const updateSearch = (payload: ScreenplayCommandPayload) => {
    const search = {
      ...state.search,
      ...(payload?.query === undefined ? {} : { query: payload.query }),
      ...(payload?.replacement === undefined ? {} : { replacement: payload.replacement }),
      ...(payload?.matchCase === undefined ? {} : { matchCase: payload.matchCase }),
    };
    publish({ search });
    target?.setSearch({
      query: search.query,
      replacement: search.replacement,
      matchCase: search.matchCase,
    });
  };

  const targetResult = (action: (currentTarget: ScreenplayCommandTarget) => boolean) => {
    if (!target) return { status: 'no-editor' } as const;
    return { status: action(target) ? 'handled' : 'no-op' } as const;
  };

  const setZoom = (percent: number) => {
    if (!target) return { status: 'no-editor' } as const;
    const zoomPercent = clamp(percent, MIN_ZOOM, MAX_ZOOM);
    publish({ zoomPercent });
    target.setZoomPercent(zoomPercent);
    return { status: 'handled' } as const;
  };

  const setFontSize = (fontSizePx: number) => {
    if (!target) return { status: 'no-editor' } as const;
    const nextSize = clamp(fontSizePx, MIN_FONT_SIZE, MAX_FONT_SIZE);
    publish({ fontSizePx: nextSize });
    target.setFontSizePx(nextSize);
    return { status: 'handled' } as const;
  };

  const copy = async (cut: boolean): Promise<ScreenplayCommandResult> => {
    if (!target) return { status: 'no-editor' };
    const selection = target.selectedText();
    if (!selection) return { status: 'no-op' };
    if (!clipboard?.writeText) return execCommandCopy(target, cut);
    await clipboard.writeText(selection);
    if (cut) target.deleteSelection();
    return { status: 'handled' };
  };

  const paste = async (): Promise<ScreenplayCommandResult> => {
    if (!target) return { status: 'no-editor' };
    if (!clipboard?.readText) return { status: 'unsupported' };
    const text = await clipboard.readText();
    target.replaceSelection(text);
    return { status: 'handled' };
  };

  const runSearchCommand = (
    commandId: 'find-next' | 'find-previous' | 'replace-next' | 'replace-all',
    payload?: ScreenplayCommandPayload,
  ): ScreenplayCommandResult => {
    if (payload) updateSearch(payload);
    if (!target) return { status: 'no-editor' };
    if (!target.hasSearchQuery()) return { status: 'no-search-query' };
    const action = {
      'find-next': (current: ScreenplayCommandTarget) => current.findNext(),
      'find-previous': (current: ScreenplayCommandTarget) => current.findPrevious(),
      'replace-next': (current: ScreenplayCommandTarget) => current.replaceNext(),
      'replace-all': (current: ScreenplayCommandTarget) => current.replaceAll(),
    }[commandId];
    return targetResult(action);
  };

  const execute = async (
    commandId: ScreenplayCommandId,
    payload?: ScreenplayCommandPayload,
  ): Promise<ScreenplayCommandResult> => {
    if (disposed) return { status: 'no-op' };
    try {
      switch (commandId) {
        case 'undo':
          return targetResult((current) => current.undo());
        case 'redo':
          return targetResult((current) => current.redo());
        case 'cut':
          return await copy(true);
        case 'copy':
          return await copy(false);
        case 'paste':
          return await paste();
        case 'select-all':
          return targetResult((current) => current.selectAll());
        case 'open-find':
        case 'open-replace': {
          if (payload) updateSearch(payload);
          const mode = commandId === 'open-find' ? 'find' : 'replace';
          publish({ search: { ...state.search, mode } });
          return targetResult((current) => current.openSearch(mode));
        }
        case 'find-next':
        case 'find-previous':
        case 'replace-next':
        case 'replace-all':
          return runSearchCommand(commandId, payload);
        case 'toggle-grammar-check': {
          if (!target) return { status: 'no-editor' };
          const grammarCheckEnabled = !state.grammarCheckEnabled;
          publish({ grammarCheckEnabled });
          target.setGrammarCheck(grammarCheckEnabled);
          return { status: 'handled' };
        }
        case 'zoom-in':
          return setZoom(state.zoomPercent + 10);
        case 'zoom-out':
          return setZoom(state.zoomPercent - 10);
        case 'zoom-reset':
          return setZoom(DEFAULT_ZOOM);
        case 'font-size-increase':
          return setFontSize(state.fontSizePx + 1);
        case 'font-size-decrease':
          return setFontSize(state.fontSizePx - 1);
        case 'font-size-reset':
          return setFontSize(DEFAULT_FONT_SIZE);
      }
    } catch (error) {
      return { status: 'failed', error };
    }
  };

  return {
    execute,
    getState: () => state,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capabilities,
    setTarget(nextTarget) {
      target = nextTarget;
      publish({ hasEditorTarget: Boolean(target) });
      if (!target) return;
      target.setGrammarCheck(state.grammarCheckEnabled);
      target.setZoomPercent(state.zoomPercent);
      target.setFontSizePx(state.fontSizePx);
      // CodeMirror's panel owns queries typed by the writer. An empty controller
      // state means "uncontrolled", not "clear the panel"—especially when the
      // same view is being re-registered after a workspace layout reset.
      const hasControlledSearch =
        state.search.query !== '' || state.search.replacement !== '' || state.search.matchCase;
      if (!hasControlledSearch) return;
      target.setSearch({
        query: state.search.query,
        replacement: state.search.replacement,
        matchCase: state.search.matchCase,
      });
    },
    dispose() {
      disposed = true;
      target = undefined;
      listeners.clear();
    },
  };
}
