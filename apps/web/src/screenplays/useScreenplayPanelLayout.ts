import { useCallback, useEffect, useState } from 'react';
import { createBrowserUuid } from '../browser-uuid';
import { collectPanelSlots } from '../workspace/layout';
import {
  createDefaultScreenplayPanelLayout,
  createScreenplayPanel,
  reduceScreenplayPanelLayout,
  screenplayPanelLayoutSchema,
  type ScreenplayPanelKind,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';

interface ScreenplayPanelLayoutOptions {
  screenplayId: string;
  onError: (message: string) => void;
}

function storedPanelLayout(screenplayId: string): ScreenplayPanelLayout {
  try {
    const stored = localStorage.getItem(`coda:screenplay-layout:${screenplayId}`);
    if (stored) return screenplayPanelLayoutSchema.parse(JSON.parse(stored));
  } catch {
    // Invalid or unavailable storage falls back to the canonical layout.
  }
  return createDefaultScreenplayPanelLayout();
}

export function useScreenplayPanelLayout({ screenplayId, onError }: ScreenplayPanelLayoutOptions) {
  const [layout, setLayout] = useState(() => storedPanelLayout(screenplayId));
  const [history, setHistory] = useState<ScreenplayPanelLayout[]>([]);
  const [fullscreenSlotId, setFullscreenSlotId] = useState<string | null>(null);

  const commit = useCallback(
    (next: ScreenplayPanelLayout) => {
      setHistory((current) => [...current.slice(-19), layout]);
      setLayout(next);
    },
    [layout],
  );

  const togglePanelKind = useCallback(
    (kind: ScreenplayPanelKind) => {
      const slots = collectPanelSlots(layout.root);
      const existing = slots.find((slot) => slot.panel.type === kind);
      try {
        if (existing) {
          if (slots.length === 1) return;
          commit(reduceScreenplayPanelLayout(layout, { type: 'close', slotId: existing.id }));
          return;
        }
        const target = slots[0];
        if (!target) return;
        const newSlotId = createBrowserUuid();
        const newPanelId = createBrowserUuid();
        const splitLayout = reduceScreenplayPanelLayout(layout, {
          type: 'split',
          slotId: target.id,
          axis: 'horizontal',
          ratioBasisPoints: 3000,
          splitId: createBrowserUuid(),
          newSlotId,
          newPanelId,
          placement: kind === 'outline' ? 'first' : 'second',
        });
        commit(
          reduceScreenplayPanelLayout(splitLayout, {
            type: 'replace',
            slotId: newSlotId,
            panel: createScreenplayPanel(kind, newPanelId),
          }),
        );
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Panel operation failed.');
      }
    },
    [commit, layout, onError],
  );

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setLayout(previous);
    setHistory((current) => current.slice(0, -1));
  }, [history]);

  const reset = useCallback(() => {
    commit(createDefaultScreenplayPanelLayout());
    setFullscreenSlotId(null);
  }, [commit]);

  useEffect(() => {
    try {
      localStorage.setItem(`coda:screenplay-layout:${screenplayId}`, JSON.stringify(layout));
    } catch {
      // A private or quota-limited browser can still use the in-memory layout.
    }
  }, [layout, screenplayId]);

  return {
    layout,
    fullscreenSlotId,
    canUndo: history.length > 0,
    setFullscreenSlotId,
    commit,
    togglePanelKind,
    undo,
    reset,
  };
}
