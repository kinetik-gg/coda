import type { ReactNode } from 'react';
import { ArrowsHorizontalIcon } from '@phosphor-icons/react/dist/csr/ArrowsHorizontal';
import { ArticleIcon } from '@phosphor-icons/react/dist/csr/Article';
import { ChartBarIcon } from '@phosphor-icons/react/dist/csr/ChartBar';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { FlowerLotusIcon } from '@phosphor-icons/react/dist/csr/FlowerLotus';
import { FrameCornersIcon } from '@phosphor-icons/react/dist/csr/FrameCorners';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { PencilLineIcon } from '@phosphor-icons/react/dist/csr/PencilLine';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { CustomSelect } from '../components/CustomSelect';
import { Tooltip } from '../components/Tooltip';
import { PanelCommandMenu } from '../workspace/PanelCommandMenu';
import type {
  WorkspacePanelControlsContext,
  WorkspacePanelMenuItem,
  WorkspacePanelRegistry,
} from '../workspace/shell';
import {
  createScreenplayPanel,
  screenplayPanelRegistry as screenplayPanelDefinitions,
  type ScreenplayPanel,
} from './screenplay-panel-layout';
import { SCREENPLAY_PREVIEW_ZOOM_LEVELS, type ScreenplayPreviewZoom } from './ScreenplayPreview';
import type { ScreenplayStatisticsView } from './ScreenplayStatisticsPanel';
import styles from './ScreenplayEditorScreen.module.css';

/** Services the screenplay editor threads to its registry-declared panel controls. */
export interface ScreenplayControlsContext {
  replacePanel: (slotId: string, panel: ScreenplayPanel) => void;
  toggleZen: (slotId: string) => void;
  exportPdf: () => void;
}

type ScreenplayControls = WorkspacePanelControlsContext<ScreenplayPanel, ScreenplayControlsContext>;

type InventoryView = 'characters' | 'locations' | 'times' | 'sections' | 'notes';

const inventoryViewOptions = [
  { value: 'characters', label: 'Characters' },
  { value: 'locations', label: 'Locations' },
  { value: 'times', label: 'Time of day' },
  { value: 'sections', label: 'Sections' },
  { value: 'notes', label: 'Notes' },
];

const statisticsViewOptions = [
  { value: 'overview', label: 'Overview' },
  { value: 'characters', label: 'Characters' },
  { value: 'scenes', label: 'Scenes & pacing' },
  { value: 'locations', label: 'Locations & setting' },
  { value: 'structure', label: 'Structure' },
];

const previewZoomOptions = [
  {
    value: 'fit-width',
    label: (
      <span className={styles.panelSelectOption}>
        <ArrowsHorizontalIcon size={12} aria-hidden="true" /> Fit Width
      </span>
    ),
  },
  {
    value: 'fit-page',
    label: (
      <span className={styles.panelSelectOption}>
        <FrameCornersIcon size={12} aria-hidden="true" /> Fit Page
      </span>
    ),
  },
  ...SCREENPLAY_PREVIEW_ZOOM_LEVELS.map((zoom) => ({
    value: String(zoom),
    label: `${String(zoom)}%`,
  })),
];

export function screenplayPreviewZoom(
  panel: Extract<ScreenplayPanel, { type: 'preview' }>,
): ScreenplayPreviewZoom {
  if (panel.config.zoomMode !== 'custom') return panel.config.zoomMode;
  const percent = Math.round(panel.config.zoom * 100);
  return SCREENPLAY_PREVIEW_ZOOM_LEVELS.find((zoom) => zoom === percent) ?? 100;
}

function OutlineControls({
  panel,
  slotId,
  panelPicker,
  replacePanel,
}: {
  panel: Extract<ScreenplayPanel, { type: 'outline' }>;
  slotId: string;
  panelPicker: ReactNode;
  replacePanel: ScreenplayControlsContext['replacePanel'];
}) {
  const metadata = (value: typeof panel.config.metadata) =>
    replacePanel(slotId, { ...panel, config: { ...panel.config, metadata: value } });
  return (
    <>
      {panelPicker}
      <nav className={styles.panelHeaderMenus} aria-label="Outline controls">
        <PanelCommandMenu
          label="Metadata"
          items={[
            {
              label: 'None',
              checked: panel.config.metadata === 'none',
              action: () => metadata('none'),
            },
            {
              label: 'Duration estimate',
              checked: panel.config.metadata === 'duration',
              action: () => metadata('duration'),
            },
            {
              label: 'Page count',
              checked: panel.config.metadata === 'pages',
              action: () => metadata('pages'),
            },
            {
              label: 'Dialogue density',
              checked: panel.config.metadata === 'dialogue-density',
              action: () => metadata('dialogue-density'),
            },
          ]}
        />
      </nav>
      <label className={styles.panelHeaderSearch}>
        <span className={styles.visuallyHidden}>Filter outline</span>
        <input
          aria-label="Filter outline"
          value={panel.config.search}
          onChange={(event) =>
            replacePanel(slotId, {
              ...panel,
              config: { ...panel.config, search: event.target.value },
            })
          }
          placeholder="Filter scenes"
        />
      </label>
    </>
  );
}

function InventoryControls({
  panel,
  slotId,
  panelPicker,
  replacePanel,
}: {
  panel: Extract<ScreenplayPanel, { type: 'inventory' }>;
  slotId: string;
  panelPicker: ReactNode;
  replacePanel: ScreenplayControlsContext['replacePanel'];
}) {
  return (
    <>
      {panelPicker}
      <div className={styles.panelHeaderControls}>
        <CustomSelect
          ariaLabel="Inventory type"
          className={styles.panelHeaderSelect}
          triggerClassName={styles.panelHeaderSelectTrigger}
          value={panel.config.view}
          options={inventoryViewOptions}
          onChange={(view) =>
            replacePanel(slotId, {
              ...panel,
              config: { ...panel.config, view: view as InventoryView },
            })
          }
        />
        <label className={styles.panelHeaderSearch}>
          <span className={styles.visuallyHidden}>Filter inventory</span>
          <input
            aria-label="Filter inventory"
            value={panel.config.search}
            onChange={(event) =>
              replacePanel(slotId, {
                ...panel,
                config: { ...panel.config, search: event.target.value },
              })
            }
            placeholder="Filter"
          />
        </label>
      </div>
    </>
  );
}

function StatisticsControls({
  panel,
  slotId,
  panelPicker,
  replacePanel,
}: {
  panel: Extract<ScreenplayPanel, { type: 'statistics' }>;
  slotId: string;
  panelPicker: ReactNode;
  replacePanel: ScreenplayControlsContext['replacePanel'];
}) {
  return (
    <>
      {panelPicker}
      <CustomSelect
        ariaLabel="Statistics view"
        className={styles.panelHeaderSelect}
        triggerClassName={styles.panelHeaderSelectTrigger}
        value={panel.config.view}
        options={statisticsViewOptions}
        onChange={(view) =>
          replacePanel(slotId, {
            ...panel,
            config: { ...panel.config, view: view as ScreenplayStatisticsView },
          })
        }
      />
    </>
  );
}

function PreviewControls({
  panel,
  slotId,
  panelPicker,
  replacePanel,
}: {
  panel: Extract<ScreenplayPanel, { type: 'preview' }>;
  slotId: string;
  panelPicker: ReactNode;
  replacePanel: ScreenplayControlsContext['replacePanel'];
}) {
  const zoom = screenplayPreviewZoom(panel);
  const setPageView = (pageView: typeof panel.config.pageView) =>
    replacePanel(slotId, { ...panel, config: { ...panel.config, pageView } });
  return (
    <>
      {panelPicker}
      <div className={styles.panelHeaderControls}>
        <CustomSelect
          ariaLabel="Preview zoom"
          className={styles.previewZoomSelect}
          triggerClassName={styles.panelHeaderSelectTrigger}
          value={String(zoom)}
          options={previewZoomOptions}
          onChange={(value) =>
            replacePanel(slotId, {
              ...panel,
              config:
                value === 'fit-width' || value === 'fit-page'
                  ? { ...panel.config, zoomMode: value }
                  : { ...panel.config, zoomMode: 'custom', zoom: Number(value) / 100 },
            })
          }
        />
        <Tooltip content="Show one screenplay page per row">
          <button
            type="button"
            className={styles.panelHeaderIconButton}
            aria-label="Single page view"
            aria-pressed={panel.config.pageView === 'single-page'}
            onClick={() => setPageView('single-page')}
          >
            <ArticleIcon size={13} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content="Show screenplay pages as two-page spreads">
          <button
            type="button"
            className={styles.panelHeaderIconButton}
            aria-label="Two-page view"
            aria-pressed={panel.config.pageView === 'two-page'}
            onClick={() => setPageView('two-page')}
          >
            <ColumnsIcon size={13} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

function EditorControls({
  panel,
  slotId,
  panelPicker,
  replacePanel,
}: {
  panel: Extract<ScreenplayPanel, { type: 'editor' }>;
  slotId: string;
  panelPicker: ReactNode;
  replacePanel: ScreenplayControlsContext['replacePanel'];
}) {
  const toggleTypewriter = () =>
    replacePanel(slotId, {
      ...panel,
      config: { ...panel.config, typewriterScrolling: !panel.config.typewriterScrolling },
    });
  const setFocus = (focusScope: 'paragraph' | 'line') =>
    replacePanel(slotId, {
      ...panel,
      config: {
        ...panel.config,
        focusMode: panel.config.focusMode && panel.config.focusScope === focusScope ? false : true,
        focusScope,
      },
    });
  return (
    <>
      {panelPicker}
      <nav className={styles.panelHeaderMenus} aria-label="Editor controls">
        <PanelCommandMenu
          label="View"
          items={[
            {
              label: 'Estimated Page Breaks',
              checked: panel.config.showPageBreaks,
              action: () =>
                replacePanel(slotId, {
                  ...panel,
                  config: { ...panel.config, showPageBreaks: !panel.config.showPageBreaks },
                }),
            },
            {
              label: 'Typewriter Scrolling',
              checked: panel.config.typewriterScrolling,
              action: toggleTypewriter,
            },
            {
              label: 'Paragraph Focus',
              checked: panel.config.focusMode && panel.config.focusScope === 'paragraph',
              separatorBefore: true,
              action: () => setFocus('paragraph'),
            },
            {
              label: 'Line Focus',
              checked: panel.config.focusMode && panel.config.focusScope === 'line',
              action: () => setFocus('line'),
            },
          ]}
        />
      </nav>
    </>
  );
}

function renderControls(context: ScreenplayControls): ReactNode {
  const { panel, slotId, panelPicker, controls } = context;
  const replacePanel = controls.replacePanel;
  if (panel.type === 'outline')
    return (
      <OutlineControls
        panel={panel}
        slotId={slotId}
        panelPicker={panelPicker}
        replacePanel={replacePanel}
      />
    );
  if (panel.type === 'inventory')
    return (
      <InventoryControls
        panel={panel}
        slotId={slotId}
        panelPicker={panelPicker}
        replacePanel={replacePanel}
      />
    );
  if (panel.type === 'statistics')
    return (
      <StatisticsControls
        panel={panel}
        slotId={slotId}
        panelPicker={panelPicker}
        replacePanel={replacePanel}
      />
    );
  if (panel.type === 'preview')
    return (
      <PreviewControls
        panel={panel}
        slotId={slotId}
        panelPicker={panelPicker}
        replacePanel={replacePanel}
      />
    );
  if (panel.type === 'editor')
    return (
      <EditorControls
        panel={panel}
        slotId={slotId}
        panelPicker={panelPicker}
        replacePanel={replacePanel}
      />
    );
  return panelPicker;
}

function renderCommands(context: ScreenplayControls): ReactNode {
  const { panel, slotId, controls } = context;
  if (panel.type !== 'editor') return undefined;
  return (
    <Tooltip content="Enter distraction-free Zen mode">
      <button
        type="button"
        className={styles.zenPanelButton}
        aria-label="Enter Zen mode"
        onClick={() => controls.toggleZen(slotId)}
      >
        <FlowerLotusIcon size={14} weight="bold" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function renderMenuItems(context: ScreenplayControls): WorkspacePanelMenuItem[] {
  const { panel, slotId, controls } = context;
  if (panel.type === 'editor')
    return [{ label: 'Enter Zen mode', action: () => controls.toggleZen(slotId) }];
  if (panel.type === 'preview') return [{ label: 'Export PDF…', action: controls.exportPdf }];
  if (panel.type === 'outline')
    return [
      {
        label: 'Clear outline filter',
        disabled: !panel.config.search,
        action: () =>
          controls.replacePanel(slotId, {
            ...panel,
            config: { ...panel.config, search: '' },
          }),
      },
    ];
  return [];
}

function definitionFor(
  type: ScreenplayPanel['type'],
  icon: ReactNode,
): WorkspacePanelRegistry<ScreenplayPanel, ScreenplayControlsContext>['definitions'][number] {
  return {
    type,
    label: screenplayPanelDefinitions[type].label,
    icon,
    createPanel: (id, current) =>
      current.type === type ? current : createScreenplayPanel(type, id),
    controls: renderControls,
    commands: renderCommands,
    menuItems: renderMenuItems,
  };
}

export const screenplayPanelRegistry: WorkspacePanelRegistry<
  ScreenplayPanel,
  ScreenplayControlsContext
> = {
  definitions: [
    definitionFor('outline', <ListBulletsIcon size={12} aria-hidden="true" />),
    definitionFor('editor', <PencilLineIcon size={12} aria-hidden="true" />),
    definitionFor('preview', <FilesIcon size={12} aria-hidden="true" />),
    definitionFor('inventory', <SquaresFourIcon size={12} aria-hidden="true" />),
    definitionFor('statistics', <ChartBarIcon size={12} aria-hidden="true" />),
  ],
  title: (panel) => screenplayPanelDefinitions[panel.type].label,
};
