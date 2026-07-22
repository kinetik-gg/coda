import { ChartBarIcon } from '@phosphor-icons/react/dist/csr/ChartBar';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { PencilLineIcon } from '@phosphor-icons/react/dist/csr/PencilLine';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { PanelWorkspaceShell } from '../workspace/shell';
import type { PanelWorkspaceShellProps, WorkspacePanelRegistry } from '../workspace/shell';
import {
  SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH,
  SCREENPLAY_PANEL_LAYOUT_MAX_PANELS,
  createScreenplayPanel,
  reduceScreenplayPanelLayout,
  screenplayPanelRegistry,
  type ScreenplayPanel,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';

const registry: WorkspacePanelRegistry<ScreenplayPanel> = {
  definitions: [
    {
      type: 'outline',
      label: screenplayPanelRegistry.outline.label,
      icon: <ListBulletsIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) =>
        current.type === 'outline' ? current : createScreenplayPanel('outline', id),
    },
    {
      type: 'editor',
      label: screenplayPanelRegistry.editor.label,
      icon: <PencilLineIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) =>
        current.type === 'editor' ? current : createScreenplayPanel('editor', id),
    },
    {
      type: 'preview',
      label: screenplayPanelRegistry.preview.label,
      icon: <FilesIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) =>
        current.type === 'preview' ? current : createScreenplayPanel('preview', id),
    },
    {
      type: 'inventory',
      label: screenplayPanelRegistry.inventory.label,
      icon: <SquaresFourIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) =>
        current.type === 'inventory' ? current : createScreenplayPanel('inventory', id),
    },
    {
      type: 'statistics',
      label: screenplayPanelRegistry.statistics.label,
      icon: <ChartBarIcon size={12} aria-hidden="true" />,
      createPanel: (id, current) =>
        current.type === 'statistics' ? current : createScreenplayPanel('statistics', id),
    },
  ],
  title: (panel) => screenplayPanelRegistry[panel.type].label,
};

export type ScreenplayWorkspaceShellProps = Omit<
  PanelWorkspaceShellProps<ScreenplayPanel, ScreenplayPanelLayout>,
  'maxDepth' | 'maxPanels' | 'panelRegistry' | 'reduceLayout'
>;

export function ScreenplayWorkspaceShell(props: ScreenplayWorkspaceShellProps) {
  return (
    <PanelWorkspaceShell<ScreenplayPanel, ScreenplayPanelLayout>
      {...props}
      reduceLayout={reduceScreenplayPanelLayout}
      panelRegistry={registry}
      showPanelMenuButton={false}
      maxPanels={SCREENPLAY_PANEL_LAYOUT_MAX_PANELS}
      maxDepth={SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH}
    />
  );
}
