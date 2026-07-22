// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityPanel } from './ActivityPanel';
import { TrashPanel } from './TrashPanel';

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderPanel(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const common = {
  project: {
    id: 'project',
    name: 'Project',
    description: null,
    ownerUserId: 'owner',
    version: 1,
    revision: 1,
    entityTypes: [],
    roles: [],
    sourceDocuments: [],
    memberships: [],
  },
  projectId: 'project',
  currentUserId: 'user',
  onSelectEntity: vi.fn(),
  onPanelChange: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workspace utility panels', () => {
  it('renders safe activity details, system actors, and search-empty states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        envelope([
          {
            id: 'activity',
            action: 'ITEM_UPDATED',
            resourceType: 'breakdown_item',
            createdAt: '2026-07-01T00:00:00.000Z',
            actor: null,
            metadata: { title: 'Scene 1', count: 2, enabled: true, hidden: { secret: true } },
          },
        ]),
      ),
    );
    const panel = {
      id: '30000000-0000-4000-8000-000000000001',
      type: 'activity' as const,
      configVersion: 1 as const,
      config: { search: '' },
    };
    const { rerender } = renderPanel(<ActivityPanel {...common} panel={panel} />);
    expect(await screen.findByText(/System/)).toBeInTheDocument();
    expect(screen.getByText('title: Scene 1')).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityPanel {...common} panel={{ ...panel, config: { search: 'missing' } }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No activity matches this view.')).toBeInTheDocument();
  });

  it('restores each trash kind and surfaces dismissible restore failures', async () => {
    let rejectRestore = false;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (rejectRestore) return Promise.reject(new Error('Restore failed.'));
        return envelope({ restored: true });
      }
      return envelope({
        items: [
          {
            id: 'item',
            title: 'Scene',
            displayCode: 'SC-1',
            deletionBatchId: 'batch',
            deletedAt: '2026-07-01T00:00:00.000Z',
            entityType: { singularName: 'Scene' },
          },
        ],
        fields: [{ id: 'field', name: 'Status', deletedAt: '2026-07-01T00:00:00.000Z' }],
        sourceDocuments: [
          { id: 'document', title: 'Script', deletedAt: '2026-07-01T00:00:00.000Z' },
        ],
        storageObjects: [
          { id: 'object', originalFilename: 'plate.exr', deletedAt: '2026-07-01T00:00:00.000Z' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const panel = {
      id: '30000000-0000-4000-8000-000000000001',
      type: 'trash' as const,
      configVersion: 1 as const,
      config: { search: '' },
    };
    renderPanel(<TrashPanel {...common} panel={panel} />);
    await screen.findByText('SC-1 — Scene');
    const restoreButtons = screen.getAllByRole('button', { name: /Restore/ });
    fireEvent.click(restoreButtons[0]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/projects/project/trash/batches/batch/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    rejectRestore = true;
    fireEvent.click(screen.getAllByRole('button', { name: /Restore/ })[1]!);
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Restore failed.');
    fireEvent.click(error);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
