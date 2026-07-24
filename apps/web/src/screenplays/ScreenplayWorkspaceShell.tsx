import { PanelWorkspaceShell } from '../workspace/shell';
import type { PanelWorkspaceShellProps } from '../workspace/shell';
import {
  SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH,
  SCREENPLAY_PANEL_LAYOUT_MAX_PANELS,
  reduceScreenplayPanelLayout,
  type ScreenplayPanel,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';
import {
  screenplayPanelRegistry,
  type ScreenplayControlsContext,
} from './screenplay-panel-registry';

export type ScreenplayWorkspaceShellProps = Omit<
  PanelWorkspaceShellProps<ScreenplayPanel, ScreenplayPanelLayout, ScreenplayControlsContext>,
  'maxDepth' | 'maxPanels' | 'panelRegistry' | 'reduceLayout'
>;

export function ScreenplayWorkspaceShell(props: ScreenplayWorkspaceShellProps) {
  return (
    <PanelWorkspaceShell<ScreenplayPanel, ScreenplayPanelLayout, ScreenplayControlsContext>
      {...props}
      reduceLayout={reduceScreenplayPanelLayout}
      panelRegistry={screenplayPanelRegistry}
      maxPanels={SCREENPLAY_PANEL_LAYOUT_MAX_PANELS}
      maxDepth={SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH}
    />
  );
}
