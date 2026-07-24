// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  WorkspaceLayout,
  WorkspaceLayoutNode,
  WorkspacePanel,
  WorkspacePanelSlot,
} from '@coda/contracts';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DenseWorkspaceView } from './DenseWorkspaceView';
import type { PanelCommandMenu } from './PanelCommandMenu';
import type { PanelContent } from './panels/PanelContent';
import type { EntityTableHeaderControls } from './panels/EntityTablePanel';
import type { InspectorHeaderControls } from './panels/InspectorPanel';
import type { PdfPanelHeaderControls } from './panels/PdfPanel';
import type { Project } from './panels/types';
import type * as ShellModule from './shell';
import type { WorkspacePanelRenderContext, WorkspaceShell, WorkspaceShellChange } from './shell';
import type { WorkspacePanelToolbarContext } from './shell/types';
import type { PanelSelector } from './WorkspacePanelSelector';

vi.mock('./shell', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellModule>()),
  WorkspaceShell: ({
    layout,
    renderPanel,
    renderPanelMenuItems,
    renderPanelToolbar,
    toolbarStart,
    toolbarEnd,
    onLayoutChange,
    onOperationError,
  }: ComponentProps<typeof WorkspaceShell>) => {
    const slots: WorkspacePanelSlot[] = [];
    const collect = (node: WorkspaceLayoutNode) => {
      if (node.kind === 'panel') slots.push(node);
      else {
        collect(node.first);
        collect(node.second);
      }
    };
    collect(layout.root);
    const panelContext = (slot: WorkspacePanelSlot): WorkspacePanelRenderContext => ({
      slot,
      slotId: slot.id,
      panel: slot.panel,
      isActive: true,
      isFullscreen: false,
    });
    const toolbarContext = (slot: WorkspacePanelSlot): WorkspacePanelToolbarContext => ({
      ...panelContext(slot),
      openPanelMenu: vi.fn(),
    });
    const layoutChange: WorkspaceShellChange = {
      reason: 'ratio',
      action: { type: 'set-ratio', splitId: 'split', ratioBasisPoints: 5000 },
    };
    return (
      <div data-testid="shell">
        {toolbarStart}
        {toolbarEnd}
        {slots.map((slot) => (
          <section key={slot.id}>
            {renderPanelToolbar?.(toolbarContext(slot))}
            {renderPanel(panelContext(slot))}
            {(renderPanelMenuItems?.(panelContext(slot)) ?? []).map((entry) => (
              <button key={entry.label} disabled={entry.disabled} onClick={entry.action}>
                shell:{entry.label}
              </button>
            ))}
          </section>
        ))}
        <button onClick={() => onLayoutChange(layout, layoutChange)}>layout</button>
        <button onClick={() => onOperationError?.(new Error('shell failed'))}>shell error</button>
      </div>
    );
  },
}));
vi.mock('./PanelCommandMenu', () => ({
  PanelCommandMenu: ({ label, items }: ComponentProps<typeof PanelCommandMenu>) => (
    <div aria-label={label}>
      {items.map((entry) => (
        <button key={entry.label} disabled={entry.disabled} onClick={entry.action}>
          {label}:{entry.label}:{String(Boolean(entry.checked))}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./WorkspacePanelSelector', () => ({
  entityTypeIcon: () => (props: { size?: number; 'aria-hidden'?: boolean }) => (
    <span {...props}>entity-icon</span>
  ),
  PanelSelector: ({ slot, onChange }: ComponentProps<typeof PanelSelector>) => (
    <button onClick={() => onChange(slot.panel)}>selector:{slot.panel.type}</button>
  ),
}));
vi.mock('./panels/PanelContent', () => ({
  PanelContent: ({
    panel,
    onPanelChange,
    onSelectEntity,
    onItemOperation,
  }: ComponentProps<typeof PanelContent>) => (
    <div>
      content:{panel.type}
      <button onClick={() => onPanelChange(panel)}>content panel</button>
      <button onClick={() => onSelectEntity(undefined)}>content select</button>
      <button onClick={() => onItemOperation?.({ label: 'change', undo: vi.fn(), redo: vi.fn() })}>
        content operation
      </button>
    </div>
  ),
}));
vi.mock('./panels/EntityTablePanel', () => ({
  EntityTableHeaderControls: ({
    panel,
    onPanelChange,
  }: ComponentProps<typeof EntityTableHeaderControls>) => (
    <button onClick={() => onPanelChange(panel)}>table header</button>
  ),
}));
vi.mock('./panels/InspectorPanel', () => ({
  InspectorHeaderControls: ({
    panel,
    onPanelChange,
  }: ComponentProps<typeof InspectorHeaderControls>) => (
    <button onClick={() => onPanelChange(panel)}>inspector header</button>
  ),
}));
vi.mock('./panels/PdfPanel', () => ({
  PdfPanelHeaderControls: ({
    panel,
    onPanelChange,
  }: ComponentProps<typeof PdfPanelHeaderControls>) => (
    <button onClick={() => onPanelChange(panel)}>pdf header</button>
  ),
}));

const ids = {
  slot: '10000000-0000-4000-8000-000000000001',
  panel: '20000000-0000-4000-8000-000000000001',
};
const project: Project = {
  id: 'project',
  name: 'Project',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [
    {
      id: 'scene',
      singularName: 'Scene',
      pluralName: 'Scenes',
      level: 1,
      version: 1,
      _count: { items: 2 },
    },
    {
      id: 'shot',
      singularName: 'Shot',
      pluralName: 'Shots',
      level: 2,
      version: 1,
      _count: { items: 3 },
    },
  ],
  roles: [],
  sourceDocuments: [],
  memberships: [],
};

function layout(panel: WorkspacePanel): WorkspaceLayout {
  return {
    schemaVersion: 1,
    root: { kind: 'panel', id: ids.slot, panel },
    view: { zoom: 1.25, textScale: 1.1 },
  };
}
function panel(type: WorkspacePanel['type']): WorkspacePanel {
  if (type === 'entity_table')
    return {
      id: ids.panel,
      type,
      configVersion: 1,
      config: {
        entityTypeId: 'shot',
        search: '',
        sort: 'manual',
        direction: 'asc',
        filters: [],
        hiddenColumns: [],
        visibleCustomFieldIds: [],
        columnWidths: {},
      },
    };
  if (type === 'inspector')
    return { id: ids.panel, type, configVersion: 1, config: { section: 'details', search: '' } };
  if (type === 'pdf')
    return {
      id: ids.panel,
      type,
      configVersion: 1,
      config: { sourceDocumentId: null, page: 1, zoom: 1 },
    };
  return { id: ids.panel, type, configVersion: 1, config: { search: '' } };
}

const base = {
  project,
  projectId: 'project',
  currentUserId: 'user',
  activeEntity: undefined,
  setActiveEntity: vi.fn(),
  saveState: 'saved' as const,
  operationError: undefined,
  queryClient: new QueryClient(),
  onLayoutChange: vi.fn(),
  updatePanel: vi.fn(),
  registerItemOperation: vi.fn(),
  onOperationError: vi.fn(),
  onDismissError: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('dense workspace view', () => {
  it('wires every entity-table command and shared shell callback', () => {
    const entity = panel('entity_table');
    render(<DenseWorkspaceView {...base} layout={layout(entity)} />);
    for (const button of screen.getAllByRole('button')) {
      if (!button.hasAttribute('disabled')) fireEvent.click(button);
    }
    expect(base.updatePanel).toHaveBeenCalled();
    expect(base.onLayoutChange).toHaveBeenCalled();
    expect(base.onOperationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'shell failed' }),
    );
    const actions: string[] = [];
    window.addEventListener('coda:panel-action', (event) =>
      actions.push((event as CustomEvent<{ action: string }>).detail.action),
    );
    fireEvent.click(screen.getByText('View:Refresh rows:false'));
    fireEvent.click(screen.getByText('Select:Select next row:false'));
    fireEvent.click(screen.getByText('Add:Add Shot…:false'));
    expect(actions).toEqual(['refresh', 'select-next', 'add-item']);
  });

  it('switches all inspector sections', () => {
    render(<DenseWorkspaceView {...base} layout={layout(panel('inspector'))} />);
    for (const name of ['Details', 'Comments', 'Source references', 'Activity'])
      fireEvent.click(screen.getByText(`View:${name}:${String(name === 'Details')}`));
    fireEvent.click(screen.getByText('inspector header'));
    expect(base.updatePanel).toHaveBeenCalledTimes(5);
  });

  it('provides PDF view, range, upload, and link commands', () => {
    const selectedEntityType = project.entityTypes[1];
    if (!selectedEntityType) throw new Error('Expected the shot entity type fixture');
    const selected = {
      entityType: selectedEntityType,
      item: {
        id: 'item',
        entityTypeId: 'shot',
        title: 'Opening',
        displayCode: 'SH-1',
        description: null,
        version: 1,
        values: [],
        sourceReferences: [],
      },
    };
    render(<DenseWorkspaceView {...base} activeEntity={selected} layout={layout(panel('pdf'))} />);
    const actions: string[] = [];
    window.addEventListener('coda:panel-action', (event) =>
      actions.push((event as CustomEvent<{ action: string }>).detail.action),
    );
    for (const label of [
      'View:Toggle dark PDF:false',
      'Select:Use current page as range:false',
      'Add:Upload PDF…:false',
      'Add:Link range to selected item:false',
    ])
      fireEvent.click(screen.getByText(label));
    expect(actions).toEqual([
      'toggle-dark',
      'use-current-page-range',
      'upload-document',
      'link-range',
    ]);
    expect(screen.getByText(/SELECTED SHOT/)).toBeTruthy();
  });

  it('refreshes utility panels, displays every canonical save state, and dismisses errors', () => {
    const { rerender } = render(
      <DenseWorkspaceView
        {...base}
        layout={layout(panel('activity'))}
        operationError="Failed"
        saveState="loading"
      />,
    );
    fireEvent.click(screen.getByText('View:Refresh:false'));
    expect(base.queryClient.isFetching()).toBe(0);
    expect(screen.getByRole('status').textContent).toContain('LOADING');
    fireEvent.click(screen.getByText('Failed'));
    expect(base.onDismissError).toHaveBeenCalled();
    rerender(<DenseWorkspaceView {...base} layout={layout(panel('trash'))} saveState="updating" />);
    expect(screen.getByRole('status').textContent).toContain('UPDATING');
    rerender(<DenseWorkspaceView {...base} layout={layout(panel('trash'))} saveState="unsaved" />);
    expect(screen.getByRole('status').textContent).toContain('UNSAVED');
    rerender(<DenseWorkspaceView {...base} layout={layout(panel('trash'))} saveState="saving" />);
    expect(screen.getByRole('status').textContent).toContain('SAVING');
    rerender(<DenseWorkspaceView {...base} layout={layout(panel('trash'))} saveState="failed" />);
    expect(screen.getByRole('status').textContent).toContain('SAVE ERROR');
    rerender(<DenseWorkspaceView {...base} layout={layout(panel('trash'))} saveState="saved" />);
    expect(screen.getByRole('status').textContent).toContain('SAVED');
  });
});
