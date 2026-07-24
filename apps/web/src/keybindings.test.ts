// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actionForKeyboardEvent,
  dispatchAppAction,
  getKeybindingLabel,
  isApplePlatform,
  isEditableKeyboardTarget,
} from './keybindings';

function setNavigatorPlatform({
  platform,
  userAgent = '',
  userAgentDataPlatform,
}: {
  platform: string;
  userAgent?: string;
  userAgentDataPlatform?: string;
}) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: userAgentDataPlatform ? { platform: userAgentDataPlatform } : undefined,
  });
}

describe('application keybindings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'userAgentData');
  });

  it('prefers userAgentData when detecting macOS and falls back to legacy hints', () => {
    expect(
      isApplePlatform({
        platform: 'Win32',
        userAgent: 'Windows',
        userAgentData: { platform: 'macOS' },
      }),
    ).toBe(true);
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })).toBe(
      true,
    );
    expect(
      isApplePlatform({
        platform: 'MacIntel',
        userAgent: 'Macintosh',
        userAgentData: { platform: 'Windows' },
      }),
    ).toBe(false);
  });

  it('matches primary shortcuts and the conventional redo alias', () => {
    setNavigatorPlatform({ platform: 'Win32', userAgentDataPlatform: 'Windows' });
    expect(
      actionForKeyboardEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true })),
    ).toBe('undoItem');
    expect(
      actionForKeyboardEvent(
        new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('redoItem');
    expect(
      actionForKeyboardEvent(new KeyboardEvent('keydown', { code: 'KeyY', ctrlKey: true })),
    ).toBe('redoItem');
    expect(
      actionForKeyboardEvent(
        new KeyboardEvent('keydown', { code: 'Equal', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('zoomIn');
  });

  it('uses Command shortcuts on macOS and does not intercept Control equivalents', () => {
    setNavigatorPlatform({ platform: 'Win32', userAgentDataPlatform: 'macOS' });

    expect(
      actionForKeyboardEvent(new KeyboardEvent('keydown', { code: 'KeyZ', metaKey: true })),
    ).toBe('undoItem');
    expect(
      actionForKeyboardEvent(
        new KeyboardEvent('keydown', { code: 'KeyZ', metaKey: true, shiftKey: true }),
      ),
    ).toBe('redoItem');
    expect(
      actionForKeyboardEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true })),
    ).toBeUndefined();
  });

  it('does not intercept commands while the user is editing', () => {
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inputEvent = new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true });
    Object.defineProperty(inputEvent, 'target', { value: input });
    expect(isEditableKeyboardTarget(editable)).toBe(true);
    expect(actionForKeyboardEvent(inputEvent)).toBeUndefined();
  });

  it('renders platform-specific shortcut labels from the shared registry', () => {
    setNavigatorPlatform({ platform: 'Win32', userAgentDataPlatform: 'Windows' });
    expect(getKeybindingLabel('undoItem')).toBe('Ctrl + Z');
    expect(getKeybindingLabel('redoItem')).toBe('Ctrl + Shift + Z');

    setNavigatorPlatform({ platform: 'MacIntel', userAgentDataPlatform: 'macOS' });
    expect(getKeybindingLabel('undoItem')).toBe('⌘Z');
    expect(getKeybindingLabel('redoItem')).toBe('⌘⇧Z');

    const listener = vi.fn();
    window.addEventListener('coda:zoom-reset', listener);
    dispatchAppAction('zoomReset');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('coda:zoom-reset', listener);
  });

  it('labels menu-only shortcuts across platforms without a global dispatch', () => {
    setNavigatorPlatform({ platform: 'Win32', userAgentDataPlatform: 'Windows' });
    expect(getKeybindingLabel('save')).toBe('Ctrl + S');
    expect(getKeybindingLabel('replace')).toBe('Ctrl + Alt + F');
    expect(getKeybindingLabel('toggleFullscreen')).toBe('F11');
    expect(getKeybindingLabel('textIncrease')).toBeUndefined();

    setNavigatorPlatform({ platform: 'MacIntel', userAgentDataPlatform: 'macOS' });
    expect(getKeybindingLabel('save')).toBe('⌘S');
    expect(getKeybindingLabel('replace')).toBe('⌘⌥F');
    expect(getKeybindingLabel('toggleFullscreen')).toBe('F11');

    // Menu-only shortcuts never enter the global keyboard dispatch path.
    expect(
      actionForKeyboardEvent(new KeyboardEvent('keydown', { code: 'KeyS', metaKey: true })),
    ).toBeUndefined();
  });

  it('dispatches undo and redo as item operations', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    window.addEventListener('coda:undo-item', undo);
    window.addEventListener('coda:redo-item', redo);
    dispatchAppAction('undoItem');
    dispatchAppAction('redoItem');
    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
    window.removeEventListener('coda:undo-item', undo);
    window.removeEventListener('coda:redo-item', redo);
  });
});
