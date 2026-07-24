import { useRef } from 'react';
import { PanelFrame } from './PanelFrame';
import { Splitter } from './Splitter';
import type { PanelLayout } from '../layout';
import type { ShellPanel, SplitTreeProps } from './types';
import styles from './WorkspaceShell.module.css';

export function SplitTree<
  TPanel extends ShellPanel,
  TLayout extends PanelLayout<TPanel>,
  TControls = void,
>({
  node,
  activeSlotId,
  fullscreenSlotId,
  panelRegistry,
  renderPanel,
  controlsContext,
  panelActions,
  onActivate,
  onRatioCommit,
}: SplitTreeProps<TPanel, TLayout, TControls>) {
  const splitRef = useRef<HTMLDivElement>(null);
  if (node.kind === 'panel') {
    const active = node.id === activeSlotId;
    const fullscreen = node.id === fullscreenSlotId;
    return (
      <PanelFrame
        slot={node}
        active={active}
        fullscreen={fullscreen}
        concealed={Boolean(fullscreenSlotId) && !fullscreen}
        panelRegistry={panelRegistry}
        actions={panelActions(node)}
        onActivate={() => onActivate(node.id)}
        controlsContext={controlsContext}
      >
        {renderPanel({
          slot: node,
          slotId: node.id,
          panel: node.panel,
          isActive: active,
          isFullscreen: fullscreen,
        })}
      </PanelFrame>
    );
  }

  return (
    <div
      ref={splitRef}
      className={`${styles.splitNode} ${node.axis === 'horizontal' ? styles.horizontalSplit : styles.verticalSplit}`}
      data-split-id={node.id}
      style={
        node.axis === 'horizontal'
          ? {
              gridTemplateColumns: `${String(node.ratioBasisPoints)}fr 2px ${String(10_000 - node.ratioBasisPoints)}fr`,
            }
          : {
              gridTemplateRows: `${String(node.ratioBasisPoints)}fr 2px ${String(10_000 - node.ratioBasisPoints)}fr`,
            }
      }
    >
      <SplitTree
        node={node.first}
        activeSlotId={activeSlotId}
        fullscreenSlotId={fullscreenSlotId}
        panelRegistry={panelRegistry}
        renderPanel={renderPanel}
        controlsContext={controlsContext}
        panelActions={panelActions}
        onActivate={onActivate}
        onRatioCommit={onRatioCommit}
      />
      <Splitter
        axis={node.axis}
        ratioBasisPoints={node.ratioBasisPoints}
        containerRef={splitRef}
        onCommit={(ratio) => onRatioCommit(node.id, ratio)}
      />
      <SplitTree
        node={node.second}
        activeSlotId={activeSlotId}
        fullscreenSlotId={fullscreenSlotId}
        panelRegistry={panelRegistry}
        renderPanel={renderPanel}
        controlsContext={controlsContext}
        panelActions={panelActions}
        onActivate={onActivate}
        onRatioCommit={onRatioCommit}
      />
    </div>
  );
}
