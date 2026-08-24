// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  listTrackerFields,
  listTrackerRecords,
  setTrackerRecordFieldValue,
} from '../../api';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import { freshBoardConfig, type BoardPanel } from './board-model';
import { TrackerBoardPanel } from './TrackerBoardPanel';

const MockApiError = vi.hoisted(
  () =>
    class MockApiError extends Error {
      constructor(readonly problem: { status: number; title: string; type: string }) {
        super(problem.title);
      }
    },
);

vi.mock('../../api', () => ({
  api: vi.fn(),
  ApiError: MockApiError,
  createTrackerRecord: vi.fn(),
  deleteTrackerRecords: vi.fn(),
  listTrackerFields: vi.fn(),
  listTrackerRecords: vi.fn(),
  setTrackerRecordFieldValue: vi.fn(),
  updateTrackerRecord: vi.fn(),
}));

const mockedFields = vi.mocked(listTrackerFields);
const mockedRecords = vi.mocked(listTrackerRecords);
const mockedSetValue = vi.mocked(setTrackerRecordFieldValue);
const mockedApi = vi.mocked(api);

function statusField(): TrackerField {
  return {
    id: 'f-status',
    name: 'Status',
    key: 'status',
    type: 'enum',
    required: false,
    version: 1,
    options: [
      { id: 'o1', label: 'Todo' },
      { id: 'o2', label: 'Done' },
    ],
  };
}

function textField(): TrackerField {
  return {
    id: 'f-note',
    name: 'Note',
    key: 'note',
    type: 'text',
    required: false,
    version: 1,
    options: [],
  };
}

function imageField(): TrackerField {
  return {
    id: 'f-art',
    name: 'Art',
    key: 'art',
    type: 'image',
    required: false,
    version: 1,
    options: [],
  };
}

function record(
  id: string,
  title: string,
  optionId?: string,
  version = 1,
  artObjectId?: string,
): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title,
    position: id,
    version,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values: [
      ...(optionId
        ? [
            {
              fieldId: 'f-status',
              textValue: null,
              integerValue: null,
              floatValue: null,
              booleanValue: null,
              dateValue: null,
              options: [],
              option: { id: optionId, label: optionId === 'o1' ? 'Todo' : 'Done' },
            },
          ]
        : []),
      {
        fieldId: 'f-note',
        textValue: `note-${id}`,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        options: [],
      },
      ...(artObjectId
        ? [
            {
              fieldId: 'f-art',
              textValue: null,
              integerValue: null,
              floatValue: null,
              booleanValue: null,
              dateValue: null,
              options: [],
              storageObjectId: artObjectId,
            },
          ]
        : []),
    ],
  };
}

function buildPanel(configOverrides = {}): BoardPanel {
  return {
    id: '30000000-0000-4000-8000-000000000002',
    type: 'board',
    configVersion: 1,
    config: { ...freshBoardConfig(), groupByFieldId: 'f-status', ...configOverrides },
  };
}

function renderBoard(panel: BoardPanel = buildPanel()) {
  const props = {
    trackerId: 't1',
    panel,
    canEdit: true,
    selectedRecord: undefined,
    onSelectRecord: vi.fn(),
    onPanelChange: vi.fn(),
    onItemOperation: vi.fn(),
    onOperationError: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TrackerBoardPanel {...props} />
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  vi.mocked(setTrackerRecordFieldValue)
    .mockReset()
    .mockRejectedValue(new Error('no move expected'));
  mockedApi.mockReset();
  mockedFields.mockReset().mockResolvedValue([statusField(), textField(), imageField()]);
  mockedRecords.mockReset().mockResolvedValue({
    items: [record('a', 'Alpha', 'o1'), record('b', 'Beta'), record('c', 'Gamma', 'o2')],
    nextCursor: null,
  });
});

afterEach(cleanup);

async function openMoveMenu(cardTitle: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Move ${cardTitle}` }));
}

describe('tracker board panel', () => {
  it('renders one lane per option plus Unassigned, each with its count', async () => {
    renderBoard();
    const todo = await screen.findByLabelText('Todo lane');
    expect(within(todo).getByText('Alpha')).toBeDefined();
    expect(within(todo).getByText('1')).toBeDefined();
    const done = screen.getByLabelText('Done lane');
    expect(within(done).getByText('Gamma')).toBeDefined();
    const unassigned = screen.getByLabelText('Unassigned lane');
    expect(within(unassigned).getByText('Beta')).toBeDefined();
    expect(within(unassigned).getByText('1')).toBeDefined();
  });

  it('moves a card through the keyboard-accessible menu and PATCHes the enum cell optimistically', async () => {
    const updated = record('b', 'Beta', 'o1', 2);
    mockedSetValue.mockResolvedValue(updated);
    const props = renderBoard();
    await openMoveMenu('Beta');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Todo' }));
    // Optimistic: the card renders in the target lane before the request settles.
    expect(within(screen.getByLabelText('Todo lane')).getByText('Beta')).toBeDefined();
    await waitFor(() =>
      expect(mockedSetValue).toHaveBeenCalledWith({
        trackerId: 't1',
        recordId: 'b',
        fieldId: 'f-status',
        value: { type: 'enum', optionId: 'o1' },
        recordVersion: 1,
      }),
    );
    await waitFor(() =>
      expect(props.onItemOperation).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Edit Status' }),
      ),
    );
  });

  it('sends a null value when a card is moved into Unassigned', async () => {
    mockedSetValue.mockResolvedValue(record('a', 'Alpha'));
    renderBoard();
    await openMoveMenu('Alpha');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Unassigned' }));
    await waitFor(() =>
      expect(mockedSetValue).toHaveBeenCalledWith(
        expect.objectContaining({ value: null, recordVersion: 1 }),
      ),
    );
  });

  it('refreshes the row and reports a conflict when the PATCH hits a version clash', async () => {
    const freshRow = record('b', 'Beta', 'o2', 7);
    mockedSetValue.mockRejectedValue(
      new ApiError({ status: 409, title: 'Version conflict', type: 'about:blank' }),
    );
    mockedApi.mockResolvedValue(freshRow);
    const props = renderBoard();
    await openMoveMenu('Beta');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Todo' }));
    await waitFor(() =>
      expect(props.onOperationError).toHaveBeenCalledWith(
        'Status changed elsewhere — the row was refreshed.',
      ),
    );
    expect(mockedApi).toHaveBeenCalledWith('/api/v1/trackers/t1/records/b');
    // The refreshed server state wins: Beta sits in Done, not in the dragged-to lane.
    await waitFor(() =>
      expect(within(screen.getByLabelText('Done lane')).getByText('Beta')).toBeDefined(),
    );
  });

  it('snaps a failed move back and surfaces the error', async () => {
    mockedSetValue.mockRejectedValue(new Error('The network dropped.'));
    const props = renderBoard();
    await openMoveMenu('Beta');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Todo' }));
    await waitFor(() =>
      expect(props.onOperationError).toHaveBeenCalledWith('The network dropped.'),
    );
    await waitFor(() =>
      expect(within(screen.getByLabelText('Unassigned lane')).getByText('Beta')).toBeDefined(),
    );
  });

  it('chains a follow-up move against the version returned by the first PATCH', async () => {
    const versions: number[] = [];
    let current = record('b', 'Beta');
    mockedSetValue.mockImplementation((input) => {
      versions.push(input.recordVersion);
      const optionId =
        input.value && typeof input.value === 'object' && 'optionId' in input.value
          ? String(input.value.optionId)
          : undefined;
      current = record('b', 'Beta', optionId, input.recordVersion + 1);
      return Promise.resolve(current);
    });
    // The invalidation refetch reads live state so the cache keeps the patched row.
    mockedRecords.mockImplementation(() =>
      Promise.resolve({
        items: [record('a', 'Alpha', 'o1'), current, record('c', 'Gamma', 'o2')],
        nextCursor: null,
      }),
    );
    renderBoard();
    await openMoveMenu('Beta');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Todo' }));
    await waitFor(() => expect(versions).toEqual([1]));
    await openMoveMenu('Beta');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Done' }));
    await waitFor(() => expect(versions).toEqual([1, 2]));
  });

  it('persists a collapsed-lane toggle in the panel config hidden columns', async () => {
    const props = renderBoard();
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse Todo' }));
    await waitFor(() => expect(props.onPanelChange).toHaveBeenCalled());
    const next = props.onPanelChange.mock.calls[0]?.[0] as BoardPanel | undefined;
    expect(next?.config.hiddenColumns).toEqual(['lane:o1']);
  });

  it('shows the unset-grouping empty state until a single-select field is chosen', () => {
    mockedRecords.mockClear();
    renderBoard(buildPanel({ groupByFieldId: '00000000-0000-0000-0000-000000000000' }));
    expect(screen.getByText(/Choose a single-select field to group by/)).toBeDefined();
  });

  it('renders read-only secondary values from the configured card fields', async () => {
    renderBoard(buildPanel({ cardFieldIds: ['f-note'] }));
    expect(await screen.findByText('note-a')).toBeDefined();
  });

  it('renders a compact media indicator on cards carrying an attachment', async () => {
    mockedRecords.mockResolvedValue({
      items: [
        record('a', 'Alpha', 'o1', 1, 'object-a'),
        record('b', 'Beta'),
        record('c', 'Gamma', 'o2'),
      ],
      nextCursor: null,
    });
    renderBoard(buildPanel({ cardFieldIds: ['f-art'] }));
    const todo = await screen.findByLabelText('Todo lane');
    // The indicator shows the generic label plus its icon; empty cells stay dashes.
    const indicators = within(todo).getAllByText('Attachment');
    expect(indicators).toHaveLength(1);
    expect(within(screen.getByLabelText('Unassigned lane')).getByText('—')).toBeDefined();
  });
});
