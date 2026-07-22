// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanelSlots } from '../workspace/layout';
import {
  createDefaultScreenplayPanelLayout,
  reduceScreenplayPanelLayout,
} from './screenplay-panel-layout';
import { useScreenplayPanelLayout } from './useScreenplayPanelLayout';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useScreenplayPanelLayout', () => {
  it('falls back from invalid storage, persists changes, and restores layout history', () => {
    localStorage.setItem('coda:screenplay-layout:script', '{not-json');
    const { result } = renderHook(() =>
      useScreenplayPanelLayout({ screenplayId: 'script', onError: vi.fn() }),
    );
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(4);

    act(() => result.current.togglePanelKind('preview'));
    expect(collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type)).toEqual([
      'editor',
      'outline',
      'inventory',
    ]);
    expect(result.current.canUndo).toBe(true);
    expect(localStorage.getItem('coda:screenplay-layout:script')).toContain('editor');

    act(() => result.current.undo());
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(4);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());

    act(() => result.current.togglePanelKind('outline'));
    act(() => result.current.togglePanelKind('outline'));
    expect(collectPanelSlots(result.current.layout.root)[0]?.panel.type).toBe('outline');
  });

  it('adds a missing typed panel and reports reducer validation failures', () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useScreenplayPanelLayout({ screenplayId: 'script', onError }),
    );
    act(() => result.current.togglePanelKind('inventory'));
    expect(
      collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type),
    ).not.toContain('inventory');
    act(() => result.current.togglePanelKind('inventory'));
    expect(collectPanelSlots(result.current.layout.root).map((slot) => slot.panel.type)).toContain(
      'inventory',
    );

    const duplicateId = result.current.layout.root.id;
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(duplicateId as `${string}-${string}-${string}-${string}-${string}`);
    act(() => result.current.togglePanelKind('inventory'));
    act(() => result.current.togglePanelKind('inventory'));
    expect(onError).toHaveBeenCalledWith('Panel IDs must be unique');

    randomUuid.mockRestore();
  });

  it('keeps the only visible panel and tolerates unavailable layout storage', () => {
    let single = createDefaultScreenplayPanelLayout();
    for (const kind of ['preview', 'outline', 'inventory'] as const) {
      const slot = collectPanelSlots(single.root).find(
        (candidate) => candidate.panel.type === kind,
      )!;
      single = reduceScreenplayPanelLayout(single, { type: 'close', slotId: slot.id });
    }
    localStorage.setItem('coda:screenplay-layout:single', JSON.stringify(single));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() =>
      useScreenplayPanelLayout({ screenplayId: 'single', onError: vi.fn() }),
    );

    act(() => result.current.togglePanelKind('editor'));
    expect(collectPanelSlots(result.current.layout.root)).toHaveLength(1);
    expect(result.current.canUndo).toBe(false);
  });
});
