import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';

export function useWorkspaceCommands({
  setLayout,
  undo,
  redo,
  reset,
  publish,
}: {
  setLayout: Dispatch<SetStateAction<WorkspaceLayout | undefined>>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  reset: () => Promise<void>;
  publish: () => Promise<void>;
}) {
  useEffect(() => {
    const updateView = (kind: 'zoom' | 'textScale', mode: 'increase' | 'decrease' | 'reset') => {
      setLayout((current) => {
        if (!current) return current;
        const existing = current.view ?? { zoom: 1, textScale: 1.2 };
        const bounds =
          kind === 'zoom' ? { min: 0.75, max: 1.5, step: 0.1 } : { min: 0.8, max: 1.4, step: 0.1 };
        const resetValue = kind === 'textScale' ? 1.2 : 1;
        const value =
          mode === 'reset'
            ? resetValue
            : Math.min(
                bounds.max,
                Math.max(
                  bounds.min,
                  Number(
                    (existing[kind] + (mode === 'increase' ? bounds.step : -bounds.step)).toFixed(
                      2,
                    ),
                  ),
                ),
              );
        return workspaceLayoutSchema.parse({
          ...current,
          view: { ...existing, [kind]: value },
        });
      });
    };
    const handlers = {
      undo: () => void undo(),
      redo: () => void redo(),
      reset: () => void reset(),
      publish: () => void publish(),
      zoomIn: () => updateView('zoom', 'increase'),
      zoomOut: () => updateView('zoom', 'decrease'),
      zoomReset: () => updateView('zoom', 'reset'),
      textIncrease: () => updateView('textScale', 'increase'),
      textDecrease: () => updateView('textScale', 'decrease'),
      textReset: () => updateView('textScale', 'reset'),
    };
    window.addEventListener('coda:undo-item', handlers.undo);
    window.addEventListener('coda:redo-item', handlers.redo);
    window.addEventListener('coda:reset-workspace', handlers.reset);
    window.addEventListener('coda:publish-workspace', handlers.publish);
    window.addEventListener('coda:zoom-in', handlers.zoomIn);
    window.addEventListener('coda:zoom-out', handlers.zoomOut);
    window.addEventListener('coda:zoom-reset', handlers.zoomReset);
    window.addEventListener('coda:text-increase', handlers.textIncrease);
    window.addEventListener('coda:text-decrease', handlers.textDecrease);
    window.addEventListener('coda:text-reset', handlers.textReset);
    return () => {
      window.removeEventListener('coda:undo-item', handlers.undo);
      window.removeEventListener('coda:redo-item', handlers.redo);
      window.removeEventListener('coda:reset-workspace', handlers.reset);
      window.removeEventListener('coda:publish-workspace', handlers.publish);
      window.removeEventListener('coda:zoom-in', handlers.zoomIn);
      window.removeEventListener('coda:zoom-out', handlers.zoomOut);
      window.removeEventListener('coda:zoom-reset', handlers.zoomReset);
      window.removeEventListener('coda:text-increase', handlers.textIncrease);
      window.removeEventListener('coda:text-decrease', handlers.textDecrease);
      window.removeEventListener('coda:text-reset', handlers.textReset);
    };
  });
}
