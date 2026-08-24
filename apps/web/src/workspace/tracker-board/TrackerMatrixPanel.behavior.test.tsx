// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listTrackerFields, listTrackerRecords } from '../../api';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import { freshMatrixConfig, type MatrixPanel } from './matrix-model';
import { TrackerMatrixPanel } from './TrackerMatrixPanel';

vi.mock('../../api', () => ({
  api: vi.fn(),
  ApiError: Error,
  createTrackerRecord: vi.fn(),
  deleteTrackerRecords: vi.fn(),
  listTrackerFields: vi.fn(),
  listTrackerRecords: vi.fn(),
  setTrackerRecordFieldValue: vi.fn(),
  updateTrackerRecord: vi.fn(),
}));

const mockedFields = vi.mocked(listTrackerFields);
const mockedRecords = vi.mocked(listTrackerRecords);

function enumField(id: string, name: string, optionIds: string[]): TrackerField {
  return {
    id,
    name,
    key: id,
    type: 'enum',
    required: false,
    version: 1,
    options: optionIds.map((optionId) => ({ id: optionId, label: `${name} ${optionId}` })),
  };
}

function record(id: string, rowOptionId?: string, colOptionId?: string): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title: `Record ${id}`,
    position: id,
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values: [
      ...(rowOptionId
        ? [
            {
              fieldId: 'f-row',
              textValue: null,
              integerValue: null,
              floatValue: null,
              booleanValue: null,
              dateValue: null,
              options: [],
              option: { id: rowOptionId, label: `Row ${rowOptionId}` },
            },
          ]
        : []),
      ...(colOptionId
        ? [
            {
              fieldId: 'f-col',
              textValue: null,
              integerValue: null,
              floatValue: null,
              booleanValue: null,
              dateValue: null,
              options: [],
              option: { id: colOptionId, label: `Col ${colOptionId}` },
            },
          ]
        : []),
    ],
  };
}

function buildPanel(overrides = {}): MatrixPanel {
  return {
    id: '30000000-0000-4000-8000-000000000003',
    type: 'matrix',
    configVersion: 1,
    config: {
      ...freshMatrixConfig(),
      rowFieldId: 'f-row',
      colFieldId: 'f-col',
      ...overrides,
    },
  };
}

function renderMatrix(panel: MatrixPanel = buildPanel()) {
  const props = {
    trackerId: 't1',
    panel,
    onSelectRecord: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TrackerMatrixPanel {...props} />
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  mockedFields
    .mockReset()
    .mockResolvedValue([
      enumField('f-row', 'Row', ['r1', 'r2']),
      enumField('f-col', 'Col', ['c1', 'c2']),
    ]);
  mockedRecords.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(cleanup);

describe('tracker matrix panel', () => {
  it('renders axis headers and aggregates matching records per cell with totals', async () => {
    mockedRecords.mockResolvedValue({
      items: [
        record('a', 'r1', 'c1'),
        record('b', 'r1', 'c1'),
        record('c', 'r1', 'c1'),
        record('d', 'r1', 'c1'),
        record('e', 'r2', 'c2'),
      ],
      nextCursor: null,
    });
    renderMatrix();
    expect(await screen.findByText('Row × Col')).toBeDefined();
    const r1row = screen.getByRole('row', { name: /Row r1/ });
    // Cell count plus the capped chip list; four records → three chips + "+1 more".
    expect(within(r1row).getAllByText('Record a')).toHaveLength(1);
    expect(within(r1row).getAllByText('4')).toHaveLength(2);
    expect(within(r1row).getByText('+1 more')).toBeDefined();
    const totalsRow = screen.getAllByText('Total').at(-1)!.closest('tr');
    expect(totalsRow).not.toBeNull();
    expect(within(totalsRow!).getByText('5')).toBeDefined();
  });

  it('caps visible chips at three before offering the popover', async () => {
    mockedRecords.mockResolvedValue({
      items: [record('a', 'r1', 'c1'), record('b', 'r1', 'c1'), record('c', 'r1', 'c1')],
      nextCursor: null,
    });
    renderMatrix();
    expect(await screen.findByText('3 MATCHES')).toBeDefined();
    // Exactly at the cap there is no "+N more" affordance.
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
    const cellChips = screen.getAllByText(/^Record /);
    expect(cellChips).toHaveLength(3);
  });

  it('opens the +N popover listing the full cell and selects back into the grid', async () => {
    mockedRecords.mockResolvedValue({
      items: [
        record('a', 'r1', 'c1'),
        record('b', 'r1', 'c1'),
        record('c', 'r1', 'c1'),
        record('d', 'r1', 'c1'),
      ],
      nextCursor: null,
    });
    const props = renderMatrix();
    fireEvent.click(await screen.findByText('+1 more'));
    const dialog = await screen.findByRole('dialog', { name: '4 records in this cell' });
    expect(within(dialog).getByText('Record d')).toBeDefined();
    fireEvent.click(within(dialog).getByText('Record d'));
    await waitFor(() =>
      expect(props.onSelectRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' })),
    );
  });

  it('shows the unset-fields empty state until both axes are configured', () => {
    renderMatrix(buildPanel({ colFieldId: '00000000-0000-0000-0000-000000000000' }));
    expect(screen.getByText(/Choose single-select fields for rows and columns/)).toBeDefined();
  });

  it('shows an empty state when either axis field has no options', async () => {
    mockedFields.mockResolvedValue([
      { ...enumField('f-row', 'Row', []), options: [] },
      enumField('f-col', 'Col', ['c1']),
    ]);
    renderMatrix();
    expect(await screen.findByText(/Neither axis field has options yet/)).toBeDefined();
  });

  it('re-aggregates when the records cache is invalidated underneath it', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      trackerId: 't1',
      panel: buildPanel(),
      onSelectRecord: vi.fn(),
    };
    mockedRecords.mockResolvedValue({
      items: [record('a', 'r1', 'c1')],
      nextCursor: null,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TrackerMatrixPanel {...props} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('1 MATCHES')).toBeDefined();
    mockedRecords.mockResolvedValue({
      items: [record('a', 'r1', 'c1'), record('b', 'r1', 'c1')],
      nextCursor: null,
    });
    await queryClient.invalidateQueries({ queryKey: ['tracker-records', 't1'] });
    await waitFor(() => expect(screen.getByText('2 MATCHES')).toBeDefined());
  });
});
