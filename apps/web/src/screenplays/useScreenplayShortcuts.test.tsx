// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { useScreenplayShortcuts } from './useScreenplayShortcuts';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('useScreenplayShortcuts', () => {
  it('routes global PDF, Zen, and escape shortcuts', () => {
    const onExitZen = vi.fn();
    const onToggleZen = vi.fn();
    const onToggleTypewriter = vi.fn();
    const onCycleFocus = vi.fn();
    const onExportPdf = vi.fn();
    renderHook(() =>
      useScreenplayShortcuts({
        editorView: { current: undefined },
        zenMode: true,
        onExitZen,
        onToggleZen,
        onToggleTypewriter,
        onCycleFocus,
        onFormat: vi.fn(),
        onExportPdf,
      }),
    );

    expect(press({ key: 'Escape' }).defaultPrevented).toBe(true);
    expect(press({ key: 'p', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'Enter', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 't', ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'f', metaKey: true, altKey: true }).defaultPrevented).toBe(true);
    expect(onExitZen).toHaveBeenCalledOnce();
    expect(onExportPdf).toHaveBeenCalledOnce();
    expect(onToggleZen).toHaveBeenCalledOnce();
    expect(onToggleTypewriter).toHaveBeenCalledOnce();
    expect(onCycleFocus).toHaveBeenCalledOnce();
  });

  it('formats only while the editor owns focus and ignores unrelated keys', () => {
    const host = document.createElement('div');
    const input = document.createElement('textarea');
    const outside = document.createElement('button');
    host.append(input);
    document.body.append(host, outside);
    const onFormat = vi.fn();
    renderHook(() =>
      useScreenplayShortcuts({
        editorView: { current: { dom: host } as unknown as EditorView },
        zenMode: false,
        onExitZen: vi.fn(),
        onToggleZen: vi.fn(),
        onToggleTypewriter: vi.fn(),
        onCycleFocus: vi.fn(),
        onFormat,
        onExportPdf: vi.fn(),
      }),
    );

    outside.focus();
    press({ key: 'b', ctrlKey: true });
    input.focus();
    press({ key: 'x', ctrlKey: true });
    expect(press({ key: 'B', ctrlKey: true }).defaultPrevented).toBe(true);
    press({ key: 'i', metaKey: true });
    press({ key: 'u', ctrlKey: true });
    press({ key: 'Escape' });
    expect(onFormat).toHaveBeenNthCalledWith(1, 'bold');
    expect(onFormat).toHaveBeenNthCalledWith(2, 'italic');
    expect(onFormat).toHaveBeenNthCalledWith(3, 'underline');
  });
});
