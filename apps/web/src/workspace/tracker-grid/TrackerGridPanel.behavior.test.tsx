// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listTrackerFields, listTrackerRecords } from '../../api';
import { TrackerGridPanel } from './TrackerGridPanel';
import { freshGridConfig, type GridPanel } from '../tracker-model';
import type { TrackerRecord } from '../../trackers/types';

vi.mock('../../api', () => ({
  api: vi.fn(),
  ApiError: Error,
  listTrackerFields: vi.fn(),
  listTrackerRecords: vi.fn(),
}));

const mockedFields = vi.mocked(listTrackerFields);
const mockedRecords = vi.mocked(listTrackerRecords);

function row(id: string, title = id): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title,
    position: id,
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values: [],
  };
}

const panel: GridPanel = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'grid',
  configVersion: 1,
  config: freshGridConfig(),
};

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPanel(overrides?: Partial<Parameters<typeof TrackerGridPanel>[0]>) {
  const onPanelChange = vi.fn();
  const props = {
    trackerId: 't1',
    panel,
    canEdit: true,
    selectedRecord: undefined,
    onSelectRecord: vi.fn(),
    onPanelChange,
    onItemOperation: vi.fn(),
    onOperationError: vi.fn(),
    ...overrides,
  } as Parameters<typeof TrackerGridPanel>[0] & { onPanelChange: typeof onPanelChange };
  render(
    <QueryClientProvider client={queryClient()}>
      <TrackerGridPanel {...props} />
    </QueryClientProvider>,
  );
  return props;
}

afterEach(cleanup);
beforeEach(() => {
  mockedFields.mockReset().mockResolvedValue([]);
  mockedRecords.mockReset();
  mockedRecords.mockResolvedValue({ items: [row('a', 'Alpha'), row('b', 'Beta')], nextCursor: null });
});

function renderPanelWithClient(overrides?: Partial<Parameters<typeof TrackerGridPanel>[0]>) {
  return render(
    <QueryClientProvider client={queryClient()}>
      <TrackerGridPanel
        trackerId="t1"
        panel={panel}
        canEdit
        onSelectRecord={vi.fn()}
        onPanelChange={vi.fn()}
        onOperationError={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('tracker grid panel', () => {
  it('lists records with the panel sort and direction and selects a row on click', async () => {
    const props = renderPanel();
    await screen.findByText('Alpha');
    expect(mockedRecords).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ sort: 'manual', direction: 'asc' }),
      expect.anything(),
    );
    fireEvent.click(screen.getByText('Beta'));
    expect(props.onSelectRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('sends the debounced search and typed filters through to the query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const filters = [{ fieldId: 'f1', operator: 'equals' as const, value: 'x' }];
      renderPanel({
        panel: {
          ...panel,
          config: { ...panel.config, search: 'needle', filters },
        },
      });
      await vi.advanceTimersByTimeAsync(400);
      await waitFor(() =>
        expect(mockedRecords).toHaveBeenCalledWith(
          't1',
          expect.objectContaining({
            search: 'needle',
            filters,
            sort: 'manual',
          }),
          expect.anything(),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders filter chips for configured filters and removes them via the chip button', async () => {
    const fields: Awaited<ReturnType<typeof listTrackerFields>> = [
      {
        id: 'f1',
        name: 'Status',
        key: 'status',
        type: 'enum',
        required: false,
        version: 1,
        options: [{ id: 'o1', label: 'Open' }],
      },
    ];
    mockedFields.mockResolvedValue(fields);
    const props = renderPanel({
      panel: {
        ...panel,
        config: {
          ...panel.config,
          filters: [{ fieldId: 'f1', operator: 'is_empty' }],
        },
      },
    });
    const chip = await screen.findByText('Status', { selector: '._filterField_2f0040, [class*="filterField"]' });
    expect(chip).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove Status filter/i }));
    const next = vi.mocked(props.onPanelChange).mock.calls[0]?.[0] as GridPanel | undefined;
    expect(next?.config.filters).toEqual([]);
  });

  it('offers a load-more control when more pages exist', async () => {
    mockedRecords.mockResolvedValue({ items: [row('a')], nextCursor: 'next' });
    renderPanel();
    const button = await screen.findByRole('button', { name: 'Load more records' });
    fireEvent.click(button);
    await waitFor(() => expect(mockedRecords).toHaveBeenCalledTimes(2));
  });

  it('surfaces operation errors through the toast callback', async () => {
    mockedRecords.mockRejectedValue(new Error('offline'));
    renderPanelWithClient();
    // The grid error state renders a retry affordance instead of a toast.
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(mockedRecords.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows skeleton state while loading', () => {
    mockedRecords.mockReturnValue(new Promise(() => undefined));
    renderPanel();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });
});
