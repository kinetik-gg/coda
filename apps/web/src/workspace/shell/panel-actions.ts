import { useEffect, useRef } from 'react';

/**
 * Unified panel-action dispatch channel for the shared workspace shell.
 *
 * Replaces the legacy `coda:panel-action` window CustomEvent. Panel content
 * registers a handler keyed by its panel id; toolbar/controls contributions
 * declared on the panel registry dispatch actions to it synchronously through
 * this typed, module-scoped bus — no global window events.
 */
export type PanelActionHandler = (action: string) => void;

const handlers = new Map<string, Set<PanelActionHandler>>();

/** Dispatch a named action to whatever panel content currently owns `panelId`. */
export function dispatchPanelAction(panelId: string, action: string): void {
  const set = handlers.get(panelId);
  if (!set) return;
  for (const handler of [...set]) handler(action);
}

/** Subscribe to actions for `panelId`. Returns an unsubscribe function. */
export function subscribePanelAction(panelId: string, handler: PanelActionHandler): () => void {
  const set = handlers.get(panelId) ?? new Set<PanelActionHandler>();
  set.add(handler);
  handlers.set(panelId, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) handlers.delete(panelId);
  };
}

/** Register panel-action handling for the lifetime of the calling component. */
export function useRegisterPanelActions(panelId: string, handler: PanelActionHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribePanelAction(panelId, (action) => latest.current(action)), [panelId]);
}
