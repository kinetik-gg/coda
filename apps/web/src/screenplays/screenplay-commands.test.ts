import { describe, expect, it, vi } from 'vitest';
import {
  createScreenplayCommandController,
  screenplayCommandDefinitions,
  type ScreenplayCommandTarget,
} from './screenplay-commands';

function createTarget(overrides: Partial<ScreenplayCommandTarget> = {}) {
  const target: ScreenplayCommandTarget = {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    selectedText: vi.fn(() => 'selected dialogue'),
    replaceSelection: vi.fn(() => true),
    deleteSelection: vi.fn(() => true),
    selectAll: vi.fn(() => true),
    setSearch: vi.fn(),
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

  it('reports clipboard and target limitations without throwing', async () => {
    const controller = createScreenplayCommandController({ clipboard: {} });

    expect(await controller.execute('undo')).toEqual({ status: 'unsupported' });
    expect(await controller.execute('copy')).toEqual({ status: 'unsupported' });
    expect(await controller.execute('paste')).toEqual({ status: 'unsupported' });
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
    expect(await controller.execute('redo')).toEqual({ status: 'unsupported' });
  });
});
