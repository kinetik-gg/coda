import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScreenplayCommandController,
  screenplayCommandDefinitions,
  screenplayCommandStatusMessage,
  type ScreenplayCommandStatus,
  type ScreenplayCommandTarget,
} from './screenplay-commands';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createTarget(overrides: Partial<ScreenplayCommandTarget> = {}) {
  const target: ScreenplayCommandTarget = {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    selectedText: vi.fn(() => 'selected dialogue'),
    replaceSelection: vi.fn(() => true),
    deleteSelection: vi.fn(() => true),
    selectAll: vi.fn(() => true),
    setSearch: vi.fn(),
    hasSearchQuery: vi.fn(() => true),
    openSearch: vi.fn(() => true),
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    replaceNext: vi.fn(() => true),
    replaceAll: vi.fn(() => true),
    setGrammarCheck: vi.fn(),
    setZoomPercent: vi.fn(),
    setFontSizePx: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  };
  return target;
}

describe('screenplay command definitions', () => {
  it('provides unique menu metadata for every command', () => {
    const ids = screenplayCommandDefinitions.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screenplayCommandDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'undo', shortcut: 'Mod-Z' }),
        expect.objectContaining({ id: 'open-replace', group: 'edit' }),
        expect.objectContaining({ id: 'toggle-grammar-check', group: 'tools' }),
        expect.objectContaining({ id: 'zoom-in', group: 'view' }),
      ]),
    );
  });
});

describe('createScreenplayCommandController', () => {
  it('routes history, selection, and search operations to the active target', async () => {
    const target = createTarget();
    const controller = createScreenplayCommandController({ target });

    await controller.execute('undo');
    await controller.execute('redo');
    await controller.execute('select-all');
    await controller.execute('open-replace', {
      query: 'INT.',
      replacement: 'EXT.',
      matchCase: true,
    });
    await controller.execute('find-next');
    await controller.execute('find-previous');
    await controller.execute('replace-next');
    await controller.execute('replace-all');

    expect(target.undo).toHaveBeenCalledOnce();
    expect(target.redo).toHaveBeenCalledOnce();
    expect(target.selectAll).toHaveBeenCalledOnce();
    expect(target.setSearch).toHaveBeenLastCalledWith({
      query: 'INT.',
      replacement: 'EXT.',
      matchCase: true,
    });
    expect(target.openSearch).toHaveBeenCalledWith('replace');
    expect(target.findNext).toHaveBeenCalledOnce();
    expect(target.findPrevious).toHaveBeenCalledOnce();
    expect(target.replaceNext).toHaveBeenCalledOnce();
    expect(target.replaceAll).toHaveBeenCalledOnce();
    expect(controller.getState().search).toEqual({
      mode: 'replace',
      query: 'INT.',
      replacement: 'EXT.',
      matchCase: true,
    });
  });

  it('cuts only after writing to the clipboard and pastes through the target', async () => {
    const target = createTarget();
    const clipboard = {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve('pasted action')),
    };
    const controller = createScreenplayCommandController({ target, clipboard });

    expect(await controller.execute('copy')).toEqual({ status: 'handled' });
    expect(await controller.execute('cut')).toEqual({ status: 'handled' });
    expect(await controller.execute('paste')).toEqual({ status: 'handled' });

    expect(clipboard.writeText).toHaveBeenNthCalledWith(1, 'selected dialogue');
    expect(clipboard.writeText).toHaveBeenNthCalledWith(2, 'selected dialogue');
    expect(target.deleteSelection).toHaveBeenCalledOnce();
    expect(target.replaceSelection).toHaveBeenCalledWith('pasted action');
  });

  it('does not delete a cut selection when clipboard writing fails', async () => {
    const target = createTarget();
    const error = new Error('Clipboard permission denied');
    const controller = createScreenplayCommandController({
      target,
      clipboard: { writeText: vi.fn(() => Promise.reject(error)) },
    });

    expect(await controller.execute('cut')).toEqual({ status: 'failed', error });
    expect(target.deleteSelection).not.toHaveBeenCalled();
  });

  it('reports every target-gated command as no-editor when no editor is registered', async () => {
    const controller = createScreenplayCommandController({ clipboard: {} });

    const targetGated = [
      'undo',
      'redo',
      'select-all',
      'cut',
      'copy',
      'paste',
      'open-find',
      'open-replace',
      'find-next',
      'find-previous',
      'replace-next',
      'replace-all',
      'toggle-grammar-check',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
      'font-size-increase',
      'font-size-decrease',
      'font-size-reset',
    ] as const;
    for (const command of targetGated) {
      expect(await controller.execute(command)).toEqual({ status: 'no-editor' });
    }
    expect(controller.getState().hasEditorTarget).toBe(false);
  });

  it('reports a genuinely missing clipboard read as unsupported when an editor exists', async () => {
    const target = createTarget();
    const controller = createScreenplayCommandController({ target, clipboard: {} });

    expect(await controller.execute('paste')).toEqual({ status: 'unsupported' });
    expect(controller.capabilities).toEqual({ read: false, write: false });
  });

  it('falls back to execCommand for copy and cut when writeText is unavailable', async () => {
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', { execCommand });
    const target = createTarget();
    const controller = createScreenplayCommandController({ target, clipboard: {} });

    expect(await controller.execute('copy')).toEqual({ status: 'handled' });
    expect(execCommand).toHaveBeenLastCalledWith('copy');
    expect(target.deleteSelection).not.toHaveBeenCalled();

    expect(await controller.execute('cut')).toEqual({ status: 'handled' });
    expect(target.focus).toHaveBeenCalled();
    expect(target.deleteSelection).toHaveBeenCalledOnce();
  });

  it('reports execCommand copy failure as unsupported without deleting the cut selection', async () => {
    vi.stubGlobal('document', { execCommand: vi.fn(() => false) });
    const target = createTarget();
    const controller = createScreenplayCommandController({ target, clipboard: {} });

    expect(await controller.execute('cut')).toEqual({ status: 'unsupported' });
    expect(target.deleteSelection).not.toHaveBeenCalled();
  });

  it('treats an empty selection as a no-op before attempting any clipboard write', async () => {
    const target = createTarget({ selectedText: vi.fn(() => '') });
    const controller = createScreenplayCommandController({ target, clipboard: {} });

    expect(await controller.execute('copy')).toEqual({ status: 'no-op' });
  });

  it('publishes grammar, zoom, and font state with bounded values', async () => {
    const target = createTarget();
    const listener = vi.fn();
    const controller = createScreenplayCommandController({
      target,
      initialState: { zoomPercent: 198, fontSizePx: 32 },
    });
    controller.subscribe(listener);

    await controller.execute('toggle-grammar-check');
    await controller.execute('zoom-in');
    await controller.execute('font-size-increase');
    await controller.execute('zoom-reset');
    await controller.execute('font-size-reset');

    expect(target.setGrammarCheck).toHaveBeenCalledWith(false);
    expect(target.setZoomPercent).toHaveBeenNthCalledWith(1, 200);
    expect(target.setFontSizePx).toHaveBeenNthCalledWith(1, 32);
    expect(controller.getState()).toMatchObject({
      grammarCheckEnabled: false,
      zoomPercent: 100,
      fontSizePx: 16,
    });
    expect(listener).toHaveBeenCalled();
  });

  it('does not publish display state when no editor can receive it', async () => {
    const controller = createScreenplayCommandController();
    const initialState = controller.getState();

    expect(await controller.execute('toggle-grammar-check')).toEqual({ status: 'no-editor' });
    expect(await controller.execute('zoom-in')).toEqual({ status: 'no-editor' });
    expect(await controller.execute('font-size-increase')).toEqual({ status: 'no-editor' });
    expect(controller.getState()).toBe(initialState);
  });

  it('reports an empty editor search query distinctly from an ordinary no-op', async () => {
    const target = createTarget({ hasSearchQuery: vi.fn(() => false) });
    const controller = createScreenplayCommandController({ target });

    expect(await controller.execute('find-next')).toEqual({ status: 'no-search-query' });
    expect(target.findNext).not.toHaveBeenCalled();
  });

  it('hydrates a target attached after controller creation and disposes safely', async () => {
    const controller = createScreenplayCommandController({
      initialState: {
        grammarCheckEnabled: false,
        zoomPercent: 125,
        fontSizePx: 18,
        search: { query: 'MAYA', replacement: 'ADA', matchCase: true },
      },
    });
    const target = createTarget();

    controller.setTarget(target);

    expect(target.setGrammarCheck).toHaveBeenCalledWith(false);
    expect(target.setZoomPercent).toHaveBeenCalledWith(125);
    expect(target.setFontSizePx).toHaveBeenCalledWith(18);
    expect(target.setSearch).toHaveBeenCalledWith({
      query: 'MAYA',
      replacement: 'ADA',
      matchCase: true,
    });

    controller.dispose();
    expect(await controller.execute('redo')).toEqual({ status: 'no-op' });
  });

  it('publishes editor-target availability as target attaches and detaches', () => {
    const listener = vi.fn();
    const controller = createScreenplayCommandController();
    controller.subscribe(listener);
    expect(controller.getState().hasEditorTarget).toBe(false);

    controller.setTarget(createTarget());
    expect(controller.getState().hasEditorTarget).toBe(true);

    controller.setTarget(undefined);
    expect(controller.getState().hasEditorTarget).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("does not overwrite an attached editor's own search panel with empty controller state", () => {
    const target = createTarget();
    const controller = createScreenplayCommandController();

    controller.setTarget(target);

    expect(target.setSearch).not.toHaveBeenCalled();
  });

  it('detects clipboard capabilities once from the supplied clipboard', () => {
    const full = createScreenplayCommandController({
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
    });
    expect(full.capabilities).toEqual({ read: true, write: true });

    const writeOnly = createScreenplayCommandController({ clipboard: { writeText: vi.fn() } });
    expect(writeOnly.capabilities).toEqual({ read: false, write: true });
  });
});

describe('screenplayCommandStatusMessage', () => {
  it('maps each status to its writer-facing notice', () => {
    expect(screenplayCommandStatusMessage('no-editor')).toBe(
      'Open a screenplay editor panel to use this command.',
    );
    expect(screenplayCommandStatusMessage('no-search-query')).toBe(
      'Enter a search query before finding or replacing text.',
    );
    expect(screenplayCommandStatusMessage('unsupported')).toBe(
      'This browser did not grant access to that editing command.',
    );
    expect(screenplayCommandStatusMessage('failed')).toBe(
      'The editing command could not be completed.',
    );
  });

  it('stays silent for handled and no-op outcomes', () => {
    for (const status of ['handled', 'no-op'] as ScreenplayCommandStatus[]) {
      expect(screenplayCommandStatusMessage(status)).toBeUndefined();
    }
  });
});
