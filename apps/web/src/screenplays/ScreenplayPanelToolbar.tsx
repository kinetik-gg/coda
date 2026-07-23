import type { ReactNode } from 'react';
import { ArrowsHorizontalIcon } from '@phosphor-icons/react/dist/csr/ArrowsHorizontal';
import { ArticleIcon } from '@phosphor-icons/react/dist/csr/Article';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { FrameCornersIcon } from '@phosphor-icons/react/dist/csr/FrameCorners';
import { CustomSelect } from '../components/CustomSelect';
import { Tooltip } from '../components/Tooltip';
import { PanelCommandMenu } from '../workspace/PanelCommandMenu';
import type { ScreenplayPanel } from './screenplay-panel-layout';
import { SCREENPLAY_PREVIEW_ZOOM_LEVELS, type ScreenplayPreviewZoom } from './ScreenplayPreview';
import type { ScreenplayStatisticsView } from './ScreenplayStatisticsPanel';
import styles from './ScreenplayEditorScreen.module.css';

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
  onReplacePanel,
}: ToolbarProps & { panel: Extract<ScreenplayPanel, { type: 'outline' }> }) {
  const metadata = (value: typeof panel.config.metadata) =>
    onReplacePanel(slotId, { ...panel, config: { ...panel.config, metadata: value } });
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
            onReplacePanel(slotId, {
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
  onReplacePanel,
}: ToolbarProps & { panel: Extract<ScreenplayPanel, { type: 'inventory' }> }) {
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
            onReplacePanel(slotId, {
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
              onReplacePanel(slotId, {
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
  onReplacePanel,
}: ToolbarProps & { panel: Extract<ScreenplayPanel, { type: 'statistics' }> }) {
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
          onReplacePanel(slotId, {
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
  onReplacePanel,
}: ToolbarProps & { panel: Extract<ScreenplayPanel, { type: 'preview' }> }) {
  const zoom = screenplayPreviewZoom(panel);
  const setPageView = (pageView: typeof panel.config.pageView) =>
    onReplacePanel(slotId, { ...panel, config: { ...panel.config, pageView } });
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
            onReplacePanel(slotId, {
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
  onReplacePanel,
}: ToolbarProps & { panel: Extract<ScreenplayPanel, { type: 'editor' }> }) {
  const toggleTypewriter = () =>
    onReplacePanel(slotId, {
      ...panel,
      config: {
        ...panel.config,
        typewriterScrolling: !panel.config.typewriterScrolling,
      },
    });
  const setFocus = (focusScope: 'paragraph' | 'line') =>
    onReplacePanel(slotId, {
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
                onReplacePanel(slotId, {
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

interface ToolbarProps {
  panel: ScreenplayPanel;
  slotId: string;
  panelPicker?: ReactNode;
  onReplacePanel: (slotId: string, panel: ScreenplayPanel) => void;
}

export function ScreenplayPanelToolbar(props: ToolbarProps) {
  if (props.panel.type === 'outline') return <OutlineControls {...props} panel={props.panel} />;
  if (props.panel.type === 'inventory') return <InventoryControls {...props} panel={props.panel} />;
  if (props.panel.type === 'statistics')
    return <StatisticsControls {...props} panel={props.panel} />;
  if (props.panel.type === 'preview') return <PreviewControls {...props} panel={props.panel} />;
  if (props.panel.type === 'editor') return <EditorControls {...props} panel={props.panel} />;
  return props.panelPicker;
}
