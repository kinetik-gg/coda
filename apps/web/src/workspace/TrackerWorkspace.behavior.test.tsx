// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceLayoutNode, WorkspacePanelSlot } from '@coda/contracts';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getTracker, listTrackerFields } from '../api';
import { TrackerWorkspaceScreen } from './TrackerWorkspaceScreen';
import type { TrackerWorkspaceView } from './TrackerWorkspaceView';
import { createDefaultTrackerWorkspaceLayout } from './tracker-recipes';

const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
  handlers: new Map<string, (event: { resource?: string }) => void>(),
}));
const activitySnapshot = vi.hoisted(() => ({ loading: 0, updating: 0 }));
const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(readonly problem: { status: number; title: string; type: string }) {
      super(problem.title);
    }
  }
  return { MockApiError };
});
function conflict() {
  return new MockApiError({ status: 409, title: 'raced', type: 'about:blank' });
}
vi.mock('socket.io-client', () => ({
  io: () => ({
    emit: socket.emit,
    on: (name: string, handler: (event: { resource?: string }) => void) => {
      socket.on(name, handler);
      socket.handlers.set(name, handler);
    },
    disconnect: socket.disconnect,
  }),
}));
vi.mock('../api', () => ({
  api: vi.fn(),
  ApiError: MockApiError,
  getTracker: vi.fn(),
  listTrackerFields: vi.fn(),
}));
vi.mock('../api-activity', () => ({
  subscribeApiActivity: () => () => undefined,
  getApiActivitySnapshot: () => activitySnapshot,
}));
vi.mock('./WorkspaceLoadingSkeleton', () => ({
  WorkspaceLoadingSkeleton: () => <div>workspace loading</div>,
}));

function firstSlot(node: WorkspaceLayoutNode): WorkspacePanelSlot {
  return node.kind === 'panel' ? node : firstSlot(node.first);
}

vi.mock('./TrackerWorkspaceView', () => ({
  TrackerWorkspaceView: (props: ComponentProps<typeof TrackerWorkspaceView>) => {
    const slot = firstSlot(props.layout.root);
    return (
      <div>
        <span>
          tracker view:{props.saveState}:{props.selectedRecord?.title ?? 'none'}
        </span>
        <span>fields:{props.fields.length}</span>
        {props.operationError && <span>operation error:{props.operationError}</span>}
        {props.publishConflict && <span>publish conflict</span>}
        <button
          onClick={() =>
            props.updatePanel(slot, {
              ...slot.panel,
              config: { ...slot.panel.config, search: 'changed' },
            } as typeof slot.panel)
          }
        >
          update panel
        </button>
        <button onClick={props.onPublishOverwrite}>publish overwrite</button>
        <button onClick={props.onAdoptLatest}>adopt latest</button>
        <button onClick={props.onDismissPublishConflict}>dismiss publish</button>
      </div>
    );
  },
}));

const mockedApi = vi.mocked(api);
const layout = createDefaultTrackerWorkspaceLayout();
const tracker = {
  id: 't1',
  ownerUserId: 'owner',
  name: 'Continuity',
  description: null,
  version: 1,
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  access: { permissions: ['read_tracker', 'edit_tracker_records'] },
};

function respond(url: string, options?: RequestInit) {
  if (url.endsWith('/workspace-layout/reset')) return { layout, revision: 4 };
  if (url.endsWith('/workspace-layout/publish')) return { layout, revision: 5 };
  if (url.endsWith('/workspace-layout') && options?.method === 'PUT')
    return { layout, revision: 2 };
  if (url.endsWith('/workspace-layout'))
    return {
      personal: { layout, revision: 1 },
      default: { layout, revision: 3 },
      canPublish: true,
    };
  if (url.endsWith('/fields'))
    return [
      { id: 'f1', name: 'Status', key: 'status', type: 'enum', required: false, version: 1, options: [] },
    ];
  if (url.endsWith('/trackers/t1')) return tracker;
  return undefined;
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TrackerWorkspaceScreen
        trackerId="t1"
        currentUser={{ id: 'user-1', displayName: 'Ari' }}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  mockedApi.mockReset();
  mockedApi.mockImplementation((url, options) => Promise.resolve(respond(String(url), options)));
  vi.mocked(getTracker).mockReset().mockImplementation(((trackerId: string) =>
    Promise.resolve(respond(`/api/v1/trackers/${trackerId}`))) as never);
  vi.mocked(listTrackerFields).mockReset().mockImplementation(((trackerId: string) =>
    Promise.resolve(respond(`/api/v1/trackers/${trackerId}/fields`))) as never);
  socket.emit.mockClear();
  socket.on.mockClear();
  socket.disconnect.mockClear();
  socket.handlers.clear();
});

describe('tracker workspace controller', () => {
  it('joins the tracker room, hydrates the layout, and disconnects on unmount', async () => {
    const view = renderScreen();
    expect(screen.getByText('workspace loading')).toBeTruthy();
    await screen.findByText('tracker view:saved:none');
    expect(screen.getByText('fields:1')).toBeTruthy();
    expect(socket.emit).toHaveBeenCalledWith('join-tracker', 't1');
    view.unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('refetches the saved layout when a published default is invalidated', async () => {
    renderScreen();
    await screen.findByText('tracker view:saved:none');
    act(() => {
      socket.handlers.get('invalidate')?.({ resource: 'workspace-default' });
    });
    await waitFor(() =>
      expect(
        mockedApi.mock.calls.filter(
          ([url]) => String(url).endsWith('/workspace-layout'),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('invalidates the tracker comment queries on comments realtime events', async () => {
    const { client } = renderScreen();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await screen.findByText('tracker view:saved:none');

    act(() => {
      socket.handlers.get('invalidate')?.({ resource: 'comments' });
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['tracker-comments', 't1'],
      }),
    );

    invalidate.mockClear();
    act(() => {
      socket.handlers.get('invalidate')?.({ resource: 'records' });
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(invalidate.mock.calls.every(([options]) => options?.queryKey?.[0] !== 'tracker-comments'))
      .toBe(true);
  });

  it('persists panel updates through the tracker layout endpoint', async () => {
    renderScreen();
    await screen.findByText('tracker view:saved:none');
    fireEvent.click(screen.getByText('update panel'));
    await waitFor(
      () =>
        expect(mockedApi).toHaveBeenCalledWith(
          '/api/v1/trackers/t1/workspace-layout',
          expect.objectContaining({ method: 'PUT' }),
        ),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.getByText(/tracker view:saved/)).toBeTruthy());
  });

  it('runs reset and publish through the shared window events', async () => {
    renderScreen();
    await screen.findByText('tracker view:saved:none');
    await act(() => Promise.resolve(window.dispatchEvent(new Event('coda:reset-workspace'))));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/trackers/t1/workspace-layout/reset',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await act(() => Promise.resolve(window.dispatchEvent(new Event('coda:publish-workspace'))));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/trackers/t1/workspace-layout/publish',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('prompts for an explicit choice when a publish loses to a concurrent publish', async () => {
    mockedApi.mockImplementation((url, options) => {
      const target = String(url);
      if (target.endsWith('/workspace-layout/publish')) return Promise.reject(conflict());
      return Promise.resolve(respond(target, options));
    });
    renderScreen();
    await screen.findByText('tracker view:saved:none');
    await act(() => Promise.resolve(window.dispatchEvent(new Event('coda:publish-workspace'))));
    expect(await screen.findByText('publish conflict')).toBeTruthy();
    // The conflict is a choice, not a raw error toast.
    expect(screen.queryByText(/operation error/)).toBeNull();
    fireEvent.click(screen.getByText('adopt latest'));
    await waitFor(() => expect(screen.queryByText('publish conflict')).toBeNull());
  });

  it('shows a retryable error when the tracker cannot be opened', async () => {
    vi.mocked(getTracker).mockReset().mockRejectedValue(new Error('offline'));
    renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    await waitFor(() =>
      expect(vi.mocked(getTracker).mock.calls.length).toBeGreaterThan(1),
    );
  });
});
