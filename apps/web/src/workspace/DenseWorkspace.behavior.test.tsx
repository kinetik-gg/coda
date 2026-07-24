// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceLayoutNode, WorkspacePanelSlot } from '@coda/contracts';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { DenseWorkspace } from './DenseWorkspace';
import type { DenseWorkspaceView } from './DenseWorkspaceView';
import { createWorkspaceRecipe } from './recipes';
import type { BreakdownItem, Project } from './panels/types';

const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
  handlers: new Map<string, (event: { resource?: string }) => void>(),
}));
const activitySnapshot = vi.hoisted(() => ({ loading: 0, updating: 0 }));
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
vi.mock('../api', () => ({ api: vi.fn() }));
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
vi.mock('./DenseWorkspaceView', () => ({
  DenseWorkspaceView: (props: ComponentProps<typeof DenseWorkspaceView>) => {
    const slot = firstSlot(props.layout.root);
    return (
      <div>
        <span>
          workspace view:{props.saveState}:{props.activeEntity?.item.title ?? 'none'}
        </span>
        {props.operationError && <span>operation error:{props.operationError}</span>}
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
        <button
          onClick={() =>
            props.onLayoutChange({ ...props.layout, view: { zoom: 1.1, textScale: 1 } })
          }
        >
          change layout
        </button>
        <button
          onClick={() =>
            props.registerItemOperation({
              label: 'item change',
              undo: vi.fn().mockResolvedValue(undefined),
              redo: vi.fn().mockResolvedValue(undefined),
            })
          }
        >
          register operation
        </button>
        <button onClick={() => props.onOperationError(new Error('view failed'))}>view error</button>
        <button onClick={props.onDismissError}>dismiss</button>
      </div>
    );
  },
}));

const mockedApi = vi.mocked(api);
const entityTypeId = '30000000-0000-4000-8000-000000000003';
const layout = createWorkspaceRecipe([{ id: entityTypeId, level: 1 }]);
const project: Project = {
  id: 'project',
  name: 'Project',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [
    { id: entityTypeId, singularName: 'Scene', pluralName: 'Scenes', level: 1, version: 1 },
  ],
  roles: [],
  sourceDocuments: [],
  memberships: [],
};
const selected: BreakdownItem = {
  id: 'item',
  entityTypeId,
  title: 'Opening',
  displayCode: null,
  description: null,
  version: 1,
  values: [],
  sourceReferences: [],
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
  if (url.includes('/items?')) return [selected];
  if (url.endsWith('/projects/project')) return project;
  return undefined;
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DenseWorkspace projectId="project" currentUserId="user" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  mockedApi.mockReset();
  mockedApi.mockImplementation((url, options) => Promise.resolve(respond(String(url), options)));
  socket.emit.mockClear();
  socket.on.mockClear();
  socket.disconnect.mockClear();
  socket.handlers.clear();
});

describe('dense workspace controller', () => {
  it('hydrates layout and active selection, saves updates, and handles socket invalidation', async () => {
    const view = renderWorkspace();
    expect(screen.getByText('workspace loading')).toBeTruthy();
    await screen.findByText('workspace view:saved:Opening');
    expect(socket.emit).toHaveBeenCalledWith('join-project', 'project');
    act(() => {
      socket.handlers.get('invalidate')?.({ resource: 'workspace-default' });
    });

    fireEvent.click(screen.getByText('update panel'));
    await waitFor(() => expect(screen.getByText(/workspace view:unsaved/)).toBeTruthy());
    await waitFor(
      () =>
        expect(mockedApi).toHaveBeenCalledWith(
          '/api/v1/projects/project/workspace-layout',
          expect.objectContaining({ method: 'PUT' }),
        ),
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.getByText(/workspace view:saved/)).toBeTruthy());
    view.unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('supports item undo/redo, reset/publish, and operation errors', async () => {
    renderWorkspace();
    await screen.findByText('workspace view:saved:Opening');
    fireEvent.click(screen.getByText('register operation'));
    await act(() => window.dispatchEvent(new Event('coda:undo-item')));
    await act(() => window.dispatchEvent(new Event('coda:redo-item')));
    await act(() => window.dispatchEvent(new Event('coda:reset-workspace')));
    await act(() => window.dispatchEvent(new Event('coda:publish-workspace')));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/projects/project/workspace-layout/reset',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/project/workspace-layout/publish',
      expect.objectContaining({ method: 'POST' }),
    );
    fireEvent.click(screen.getByText('view error'));
    expect(screen.getByText('operation error:view failed')).toBeTruthy();
    fireEvent.click(screen.getByText('dismiss'));
    expect(screen.queryByText('operation error:view failed')).toBeNull();
  });

  it('blocks publish while dirty and surfaces save failures', async () => {
    mockedApi.mockImplementation((url, options) => {
      if (String(url).endsWith('/workspace-layout') && options?.method === 'PUT')
        return Promise.reject(new Error('save failed'));
      return Promise.resolve(respond(String(url), options));
    });
    renderWorkspace();
    await screen.findByText('workspace view:saved:Opening');
    fireEvent.click(screen.getByText('change layout'));
    await act(() => window.dispatchEvent(new Event('coda:publish-workspace')));
    expect(await screen.findByText(/Wait for personal layout changes/)).toBeTruthy();
    expect(
      await screen.findByText('operation error:save failed', {}, { timeout: 2000 }),
    ).toBeTruthy();
    expect(screen.getByText(/workspace view:failed/)).toBeTruthy();
  });

  it('shows a retryable error when project loading fails', async () => {
    mockedApi.mockImplementation((url, options) => {
      if (String(url).endsWith('/projects/project')) return Promise.reject(new Error('offline'));
      return Promise.resolve(respond(String(url), options));
    });
    renderWorkspace();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(
      mockedApi.mock.calls.filter(([url]) => String(url).endsWith('/projects/project')).length,
    ).toBeGreaterThan(1);
  });
});
