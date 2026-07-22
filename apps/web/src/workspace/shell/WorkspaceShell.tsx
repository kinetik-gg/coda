import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import { Tooltip } from '../../components/Tooltip';
import type { WorkspaceLayoutAction, LayoutDirection } from '../layout';
import {
  WORKSPACE_LAYOUT_MAX_DEPTH,
  WORKSPACE_LAYOUT_MAX_PANELS,
  collectPanelSlots,
  deriveAdjacency,
  joinPanelDirectionally,
  reduceWorkspaceLayout,
} from '../layout';
import { SplitTree } from './SplitTree';
import type { PanelFrameActions, WorkspaceShellChangeReason, WorkspaceShellProps } from './types';
import styles from './WorkspaceShell.module.css';

const directions: readonly LayoutDirection[] = ['left', 'right', 'up', 'down'];

function slotDepth(
  node: WorkspaceShellProps['layout']['root'],
  slotId: string,
  depth = 1,
): number | undefined {
  if (node.kind === 'panel') return node.id === slotId ? depth : undefined;
  return slotDepth(node.first, slotId, depth + 1) ?? slotDepth(node.second, slotId, depth + 1);
}

function defaultId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure UUID generation is unavailable');
  return globalThis.crypto.randomUUID();
}

export function WorkspaceShell({
  layout,
  onLayoutChange,
  renderPanel,
  renderPanelToolbar,
  renderPanelCommands,
  renderPanelMenuItems,
  toolbarStart,
  toolbarEnd,
  canUndo = false,
  onUndo,
  activeSlotId: controlledActiveSlotId,
  onActiveSlotChange,
  fullscreenSlotId: controlledFullscreenSlotId,
  onFullscreenSlotChange,
  onOperationError,
  createId = defaultId,
  className,
}: WorkspaceShellProps) {
  const slots = useMemo(() => collectPanelSlots(layout.root), [layout.root]);
  const [internalActiveSlotId, setInternalActiveSlotId] = useState(slots[0]?.id ?? '');
  const [internalFullscreenSlotId, setInternalFullscreenSlotId] = useState<string | null>(null);
  const activeSlotId = controlledActiveSlotId ?? internalActiveSlotId;
  const fullscreenSlotId =
    controlledFullscreenSlotId === undefined
      ? internalFullscreenSlotId
      : controlledFullscreenSlotId;

  const setActiveSlot = useCallback(
    (slotId: string) => {
      if (controlledActiveSlotId === undefined) setInternalActiveSlotId(slotId);
      onActiveSlotChange?.(slotId);
    },
    [controlledActiveSlotId, onActiveSlotChange],
  );
  const setFullscreenSlot = useCallback(
    (slotId: string | null) => {
      if (controlledFullscreenSlotId === undefined) setInternalFullscreenSlotId(slotId);
      onFullscreenSlotChange?.(slotId);
    },
    [controlledFullscreenSlotId, onFullscreenSlotChange],
  );

  useEffect(() => {
    if (!slots.some((slot) => slot.id === activeSlotId) && slots[0]) setActiveSlot(slots[0].id);
    if (fullscreenSlotId && !slots.some((slot) => slot.id === fullscreenSlotId))
      setFullscreenSlot(null);
  }, [activeSlotId, fullscreenSlotId, setActiveSlot, setFullscreenSlot, slots]);

  useEffect(() => {
    if (!fullscreenSlotId) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenSlot(null);
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [fullscreenSlotId, setFullscreenSlot]);

  const adjacency = useMemo(() => deriveAdjacency(layout), [layout]);
  const nearestAdjacent = useCallback(
    (slotId: string, direction: LayoutDirection) =>
      adjacency
        .filter((entry) => entry.fromSlotId === slotId && entry.direction === direction)
        .sort(
          (first, second) =>
            second.sharedEdge - first.sharedEdge || first.toSlotId.localeCompare(second.toSlotId),
        )[0]?.toSlotId,
    [adjacency],
  );

  const commit = useCallback(
    (action: WorkspaceLayoutAction, reason: WorkspaceShellChangeReason) => {
      try {
        const next = reduceWorkspaceLayout(layout, action);
        onLayoutChange(next, { reason, action });
        return next;
      } catch (error) {
        onOperationError?.(error instanceof Error ? error : new Error('Layout operation failed'));
        return null;
      }
    },
    [layout, onLayoutChange, onOperationError],
  );

  const panelActions = useCallback(
    (slot: (typeof slots)[number]): PanelFrameActions => {
      const joinAvailability = Object.fromEntries(
        directions.map((direction) => [
          direction,
          joinPanelDirectionally(layout, slot.id, direction) !== null,
        ]),
      ) as Record<LayoutDirection, boolean>;
      const swapTargets = Object.fromEntries(
        directions.map((direction) => [direction, nearestAdjacent(slot.id, direction)]),
      ) as Record<LayoutDirection, string | undefined>;
      return {
        canSplit:
          slots.length < WORKSPACE_LAYOUT_MAX_PANELS &&
          (slotDepth(layout.root, slot.id) ?? WORKSPACE_LAYOUT_MAX_DEPTH) <
            WORKSPACE_LAYOUT_MAX_DEPTH,
        canClose: slots.length > 1,
        canJoin: joinAvailability,
        canSwap: Object.fromEntries(
          directions.map((direction) => [direction, Boolean(swapTargets[direction])]),
        ) as Record<LayoutDirection, boolean>,
        onSplit: (axis) => {
          commit(
            {
              type: 'split',
              slotId: slot.id,
              axis,
              ratioBasisPoints: 5000,
              splitId: createId(),
              newSlotId: createId(),
              newPanelId: createId(),
            },
            'split',
          );
        },
        onJoin: (direction) => {
          commit({ type: 'join', slotId: slot.id, direction }, 'join');
        },
        onSwap: (direction) => {
          const target = swapTargets[direction];
          if (target) commit({ type: 'swap', firstSlotId: slot.id, secondSlotId: target }, 'swap');
        },
        onClose: () => {
          const next = commit({ type: 'close', slotId: slot.id }, 'close');
          if (!next) return;
          if (fullscreenSlotId === slot.id) setFullscreenSlot(null);
          const nextSlot = collectPanelSlots(next.root)[0];
          if (activeSlotId === slot.id && nextSlot) setActiveSlot(nextSlot.id);
        },
        onToggleFullscreen: () => setFullscreenSlot(fullscreenSlotId === slot.id ? null : slot.id),
      };
    },
    [
      activeSlotId,
      commit,
      createId,
      fullscreenSlotId,
      layout,
      nearestAdjacent,
      setActiveSlot,
      setFullscreenSlot,
      slots,
    ],
  );

  return (
    <section className={`${styles.shell} ${className ?? ''}`} aria-label="Workspace">
      <header className={styles.toolbar}>
        {toolbarStart}
        <div className={styles.toolbarSpacer} />
        {onUndo && (
          <Tooltip content="Restore the workspace layout to its previous arrangement">
            <button type="button" disabled={!canUndo} onClick={onUndo}>
              <ArrowUUpLeftIcon size={12} weight="bold" aria-hidden="true" />
              <span>Undo</span>
            </button>
          </Tooltip>
        )}
        {toolbarEnd}
      </header>
      <div className={styles.layoutSurface}>
        <SplitTree
          node={layout.root}
          activeSlotId={activeSlotId}
          fullscreenSlotId={fullscreenSlotId}
          renderPanel={renderPanel}
          renderPanelToolbar={renderPanelToolbar}
          renderPanelCommands={renderPanelCommands}
          renderPanelMenuItems={renderPanelMenuItems}
          panelActions={panelActions}
          onActivate={setActiveSlot}
          onRatioCommit={(splitId, ratioBasisPoints) =>
            commit({ type: 'set-ratio', splitId, ratioBasisPoints }, 'ratio')
          }
        />
      </div>
    </section>
  );
}
