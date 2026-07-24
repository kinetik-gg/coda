import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import {
  WORKSPACE_LAYOUT_MAX_DEPTH,
  WORKSPACE_LAYOUT_MAX_PANELS,
  type WorkspacePanel,
} from '@coda/contracts';
import { Tooltip } from '../../components/Tooltip';
import { createBrowserUuid } from '../../browser-uuid';
import {
  collectPanelSlots,
  deriveAdjacency,
  joinPanelDirectionally,
  reduceWorkspaceLayout,
  type LayoutDirection,
  type PanelLayout,
  type PanelLayoutAction,
  type PanelLayoutNode,
} from '../layout';
import { SplitTree } from './SplitTree';
import { breakdownPanelRegistry } from './breakdown-panel-registry';
import type {
  PanelFrameActions,
  PanelWorkspaceShellProps,
  ShellPanel,
  WorkspaceShellChangeReason,
  WorkspaceShellProps,
} from './types';
import styles from './WorkspaceShell.module.css';

const directions: readonly LayoutDirection[] = ['left', 'right', 'up', 'down'];

function slotDepth<TPanel extends ShellPanel>(
  node: PanelLayoutNode<TPanel>,
  slotId: string,
  depth = 1,
): number | undefined {
  if (node.kind === 'panel') return node.id === slotId ? depth : undefined;
  return slotDepth(node.first, slotId, depth + 1) ?? slotDepth(node.second, slotId, depth + 1);
}

function defaultId(): string {
  return createBrowserUuid();
}

export function PanelWorkspaceShell<
  TPanel extends ShellPanel,
  TLayout extends PanelLayout<TPanel>,
>({
  layout,
  onLayoutChange,
  reduceLayout,
  panelRegistry,
  maxPanels,
  maxDepth,
  renderPanel,
  renderPanelToolbar,
  renderPanelCommands,
  renderPanelMenuItems,
  showPanelMenuButton = true,
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
}: PanelWorkspaceShellProps<TPanel, TLayout>) {
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
    (action: PanelLayoutAction<TPanel>, reason: WorkspaceShellChangeReason) => {
      try {
        const next = reduceLayout(layout, action);
        onLayoutChange(next, { reason, action });
        return next;
      } catch (error) {
        onOperationError?.(error instanceof Error ? error : new Error('Layout operation failed'));
        return null;
      }
    },
    [layout, onLayoutChange, onOperationError, reduceLayout],
  );

  const panelActions = useCallback(
    (slot: (typeof slots)[number]): PanelFrameActions<TPanel> => {
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
          slots.length < maxPanels && (slotDepth(layout.root, slot.id) ?? maxDepth) < maxDepth,
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
        onReplace: (panel) => {
          commit({ type: 'replace', slotId: slot.id, panel }, 'replace');
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
      maxDepth,
      maxPanels,
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
        <div className={styles.toolbarTrailing}>
          {onUndo && (
            <Tooltip content="Restore the workspace layout to its previous arrangement">
              <button type="button" disabled={!canUndo} onClick={onUndo}>
                <ArrowUUpLeftIcon size={12} weight="bold" aria-hidden="true" />
                <span>Undo</span>
              </button>
            </Tooltip>
          )}
          {toolbarEnd}
        </div>
      </header>
      <div className={styles.layoutSurface}>
        <SplitTree
          node={layout.root}
          activeSlotId={activeSlotId}
          fullscreenSlotId={fullscreenSlotId}
          panelRegistry={panelRegistry}
          renderPanel={renderPanel}
          renderPanelToolbar={renderPanelToolbar}
          renderPanelCommands={renderPanelCommands}
          renderPanelMenuItems={renderPanelMenuItems}
          showPanelMenuButton={showPanelMenuButton}
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

export function WorkspaceShell(props: WorkspaceShellProps) {
  return (
    <PanelWorkspaceShell<WorkspacePanel, WorkspaceShellProps['layout']>
      {...props}
      reduceLayout={reduceWorkspaceLayout}
      panelRegistry={breakdownPanelRegistry}
      maxPanels={WORKSPACE_LAYOUT_MAX_PANELS}
      maxDepth={WORKSPACE_LAYOUT_MAX_DEPTH}
    />
  );
}
