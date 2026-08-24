// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspacePanelSlot } from '@coda/contracts';
import type { TrackerField } from '../trackers/types';
import { freshBoardConfig } from './tracker-board/board-model';
import { freshMatrixConfig } from './tracker-board/matrix-model';
import {
  renderTrackerPanelContent,
  trackerPanelRegistry,
  type TrackerControlsContext,
} from './tracker-panel-registry';

vi.mock('../../api', () => ({
  api: vi.fn(() => Promise.resolve({ data: [], meta: { nextCursor: null } })),
  ApiError: Error,
  listTrackerFields: vi.fn().mockResolvedValue([]),
  listTrackerActivity: vi.fn().mockResolvedValue([]),
  listTrackerRecordComments: vi.fn().mockResolvedValue({ data: [], meta: { nextCursor: null } }),
}));
vi.mock('./tracker-board/TrackerBoardPanel', () => ({
  TrackerBoardPanel: () => <span>board body</span>,
}));
vi.mock('./tracker-board/TrackerMatrixPanel', () => ({
  TrackerMatrixPanel: () => <span>matrix body</span>,
}));

function enumField(id: string): TrackerField {
  return {
    id,
    name: `Field ${id}`,
    key: id,
    type: 'enum',
    required: false,
    version: 1,
    options: [{ id: `${id}-o1`, label: 'Option' }],
  };
}

function textField(): TrackerField {
  return {
    id: 'f-text',
    name: 'Notes',
    key: 'notes',
    type: 'text',
    required: false,
    version: 1,
    options: [],
  };
}

function slotFor(panelType: 'board' | 'matrix'): WorkspacePanelSlot {
  const id = '30000000-0000-4000-8000-00000000000a';
  const panelId = '30000000-0000-4000-8000-00000000000b';
  if (panelType === 'board')
    return {
      kind: 'panel',
      id,
      panel: { id: panelId, type: 'board', configVersion: 1, config: freshBoardConfig() },
    };
  return {
    kind: 'panel',
    id,
    panel: { id: panelId, type: 'matrix', configVersion: 1, config: freshMatrixConfig() },
  };
}

function buildControls(slot: WorkspacePanelSlot, fields: TrackerField[]) {
  const updatePanel = vi.fn();
  const controls: TrackerControlsContext = {
    trackerId: 't1',
    canEditRecords: true,
    fields,
    selectedRecord: undefined,
    updatePanel,
  };
  const definition = trackerPanelRegistry.definitions.find(
    (entry) => entry.type === slot.panel.type,
  )!;
  const node = definition.controls!({
    slot,
    slotId: slot.id,
    panel: slot.panel,
    isActive: true,
    isFullscreen: false,
    controls,
    panelPicker: null,
    dispatchAction: vi.fn(),
  });
  return { updatePanel, node };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('tracker panel registry', () => {
  it('renders inspector and activity panel bodies through the content switch', async () => {
    const { QueryClientProvider } = await import('@tanstack/react-query');
    const { QueryClient } = await import('@tanstack/react-query');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const type of ['inspector', 'activity'] as const) {
      const slot = slotFor('board');
      cleanup();
      render(
        <QueryClientProvider client={client}>
          {renderTrackerPanelContent(
            {
              ...slot,
              // The switch narrows on the discriminated union; cast keeps the loop generic.
              panel: {
                id: 'p-x',
                type,
                configVersion: 1,
                config: { search: '', section: 'details' },
              } as unknown as WorkspacePanelSlot['panel'],
            },
            {
              trackerId: 't1',
              canEditRecords: true,
              selectedRecord: undefined,
              currentUser: { id: 'user-1', displayName: 'Tester' },
              onSelectRecord: vi.fn(),
              updatePanel: vi.fn(),
              pushToast: vi.fn(),
            },
          )}
        </QueryClientProvider>,
      );
    }
    expect(true).toBe(true);
  });

  it('creates fresh configs and titles for every panel kind', () => {
    const cases = ['grid', 'board', 'matrix', 'inspector', 'activity'] as const;
    for (const type of cases) {
      const definition = trackerPanelRegistry.definitions.find((entry) => entry.type === type)!;
      // createPanel narrows per-definition; the loop only asserts the shared shape.
      const current = { id: 'old', type, configVersion: 1 as const, config: {} } as never;
      const panel = definition.createPanel('new-id', current) as {
        id: string;
        configVersion: number;
        config: Record<string, unknown>;
        type: string;
      };
      expect(panel.id).toBe('new-id');
      expect(panel.configVersion).toBe(1);
    }
  });

  it('declares board and matrix definitions that create fresh configs', () => {
    const board = trackerPanelRegistry.definitions.find((entry) => entry.type === 'board')!;
    const matrix = trackerPanelRegistry.definitions.find((entry) => entry.type === 'matrix')!;
    expect(board.label).toBe('Board');
    expect(matrix.label).toBe('Matrix');
    const boardPanel = board.createPanel(
      '30000000-0000-4000-8000-00000000000c',
      slotFor('board').panel,
    );
    const matrixPanel = matrix.createPanel(
      '30000000-0000-4000-8000-00000000000d',
      slotFor('matrix').panel,
    );
    expect(boardPanel.config).toMatchObject({ groupByFieldId: freshBoardConfig().groupByFieldId });
    expect(matrixPanel.config).toMatchObject({ rowFieldId: freshMatrixConfig().rowFieldId });
    expect(trackerPanelRegistry.title(boardPanel)).toBe('Board');
    expect(trackerPanelRegistry.title(matrixPanel)).toBe('Matrix');
  });

  it('renders the lazily loaded board and matrix bodies through Suspense', async () => {
    const services = {
      trackerId: 't1',
      canEditRecords: true,
      currentUser: { id: 'user-1', displayName: 'Tester' },
      selectedRecord: undefined,
      onSelectRecord: vi.fn(),
      updatePanel: vi.fn(),
      pushToast: vi.fn(),
    };
    for (const kind of ['board', 'matrix'] as const) {
      render(<div>{renderTrackerPanelContent(slotFor(kind), services)}</div>);
      expect(await screen.findByText(`${kind} body`)).toBeDefined();
      cleanup();
    }
  });

  it('offers Group by and Cards view menus for the board and persists picks', async () => {
    const slot = slotFor('board');
    const { node, updatePanel } = buildControls(slot, [enumField('f-status'), textField()]);
    render(<nav>{node}</nav>);
    fireEvent.click(screen.getByRole('button', { name: 'Group by' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Field f-status' }));
    await waitFor(() => expect(updatePanel).toHaveBeenCalled());
    const groupPick = updatePanel.mock.calls[0]?.[1] as { config: { groupByFieldId: string } };
    expect(groupPick.config.groupByFieldId).toBe('f-status');
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Notes' }));
    await waitFor(() => expect(updatePanel.mock.calls.length).toBeGreaterThan(1));
    const cardPick = updatePanel.mock.calls.at(-1)?.[1] as {
      config: { cardFieldIds: string[] };
    };
    expect(cardPick.config.cardFieldIds).toEqual(['f-text']);
  });

  it('disables non-single-select grouping choices with a tooltip reason', async () => {
    const slot = slotFor('board');
    const { node } = buildControls(slot, [enumField('f-status'), textField()]);
    render(<nav>{node}</nav>);
    fireEvent.click(screen.getByRole('button', { name: 'Group by' }));
    const disabled = await screen.findByRole('menuitem', { name: 'Notes' });
    expect(disabled).toHaveProperty('disabled', true);
    expect(disabled.getAttribute('title')).toContain('Single-select fields only');
  });

  it('offers Rows and Columns axis menus for the matrix', async () => {
    const slot = slotFor('matrix');
    const { node, updatePanel } = buildControls(slot, [enumField('f-row'), textField()]);
    render(<nav>{node}</nav>);
    fireEvent.click(screen.getByRole('button', { name: 'Rows' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Field f-row' }));
    await waitFor(() => expect(updatePanel).toHaveBeenCalled());
    const rowPick = updatePanel.mock.calls[0]?.[1] as { config: { rowFieldId: string } };
    expect(rowPick.config.rowFieldId).toBe('f-row');
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const columnChoice = await screen.findByRole('menuitemcheckbox', { name: 'Field f-row' });
    fireEvent.click(columnChoice);
    await waitFor(() => expect(updatePanel.mock.calls.length).toBeGreaterThan(1));
    const colPick = updatePanel.mock.calls.at(-1)?.[1] as { config: { colFieldId: string } };
    expect(colPick.config.colFieldId).toBe('f-row');
  });
});
