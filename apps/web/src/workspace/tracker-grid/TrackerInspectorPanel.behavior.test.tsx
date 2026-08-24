// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackerRecord } from '../../trackers/types';
import { TrackerInspectorPanel } from './TrackerInspectorPanel';

vi.mock('../../api', () => ({
  api: vi.fn(),
  ApiError: Error,
  listTrackerFields: vi.fn().mockResolvedValue([]),
  listTrackerActivity: vi.fn().mockResolvedValue([]),
  listTrackerRecordComments: vi.fn().mockResolvedValue({ data: [], meta: { nextCursor: null } }),
  updateTrackerRecord: vi.fn(),
  setTrackerRecordFieldValue: vi.fn(),
}));

afterEach(cleanup);

function record(): TrackerRecord {
  return {
    id: 'rec1',
    trackerId: 't1',
    title: 'Dock scene',
    position: 'aaa',
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values: [],
  };
}

const baseConfig = { section: 'details', search: '' };
const inspectorPanel = {
  id: '31000000-0000-4000-8000-000000000001',
  type: 'inspector' as const,
  configVersion: 1 as const,
  config: baseConfig,
};

function renderInspector(overrides?: {
  selectedRecord?: TrackerRecord;
  canEdit?: boolean;
  section?: 'details' | 'comments' | 'activity';
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrackerInspectorPanel
        trackerId="t1"
        panel={{
          ...inspectorPanel,
          config: { ...baseConfig, section: overrides?.section ?? 'details' },
        }}
        selectedRecord={overrides?.selectedRecord}
        canEdit={overrides?.canEdit ?? true}
        currentUser={{ id: 'user-1', displayName: 'Tester' }}
      />
    </QueryClientProvider>,
  );
}

describe('TrackerInspectorPanel', () => {
  it('shows the empty state when no record is selected', () => {
    renderInspector();
    expect(screen.getByText('Select a record in the grid to inspect it here.')).toBeDefined();
  });

  it('renders the title property for the selected record', async () => {
    renderInspector({ selectedRecord: record() });
    expect(await screen.findByText('TITLE')).toBeDefined();
  });

  it('renders the comments section on demand', async () => {
    renderInspector({ selectedRecord: record(), section: 'comments' });
    expect(await screen.findByRole('textbox')).toBeDefined();
  });

  it('renders read-only fields when the caller cannot edit', async () => {
    renderInspector({ selectedRecord: record(), canEdit: false });
    expect(await screen.findByText('TITLE')).toBeDefined();
  });

  it('renders the activity section on demand', async () => {
    renderInspector({ section: 'activity' });
    await vi.waitFor(() => {
      expect(listTrackerActivityMock).toHaveBeenCalled();
    });
  });
});

import { listTrackerActivity } from '../../api';
const listTrackerActivityMock = vi.mocked(listTrackerActivity);
