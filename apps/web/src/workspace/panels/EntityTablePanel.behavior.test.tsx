// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DragEndEvent } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspacePanel } from '@coda/contracts';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiCursorPage } from '../../api';
import { EntityTablePanel } from './EntityTablePanel';
import type {
  EntityTableContextMenu,
  EntityTableDialogs,
  EntityTableGrid,
} from './EntityTableView';
import type { BreakdownItem, Project } from './types';

vi.mock('../../api', () => ({ api: vi.fn(), apiCursorPage: vi.fn() }));

function firstItem(items: BreakdownItem[]): BreakdownItem {
  const first = items[0];
  if (!first) throw new Error('Expected at least one item fixture');
  return first;
}

function dragEndEvent(activeId: string, overId: string): DragEndEvent {
  const rect = { width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 };
  return {
    activatorEvent: new Event('pointerdown'),
    active: {
      id: activeId,
      data: { current: undefined },
      rect: { current: { initial: rect, translated: rect } },
    },
    collisions: null,
    delta: { x: 0, y: 0 },
    over: {
      id: overId,
      rect,
      disabled: false,
      data: { current: undefined },
    },
  };
}

vi.mock('./EntityTableView', () => ({
  EntityTableGrid: (props: ComponentProps<typeof EntityTableGrid>) => (
    <div>
      grid:{props.items.length}:{String(props.loading)}:{String(Boolean(props.error))}
      <button onClick={props.onLoadMore}>load rows</button>
      <button onClick={props.onRetry}>retry rows</button>
      <button onClick={() => props.onSelect(firstItem(props.items))}>select row</button>
      <button onClick={() => props.onEdit(firstItem(props.items))}>edit row</button>
      <button onClick={(event) => props.onOpenMenu(event, firstItem(props.items))}>
        open row menu
      </button>
      <button onClick={() => props.onReorder(dragEndEvent('one', 'two'))}>reorder rows</button>
      <table>
        <thead>
          <tr>
            <th>
              <span data-column-label>Title</span>
              <button onPointerDown={(event) => props.onResize(event, 'title')}>
                resize title
              </button>
            </th>
          </tr>
        </thead>
      </table>
    </div>
  ),
  EntityTableContextMenu: ({
    menu,
    menuRef,
    onAdd,
    onEdit,
    onDelete,
  }: ComponentProps<typeof EntityTableContextMenu>) =>
    menu ? (
      <div ref={menuRef}>
        <button onClick={onAdd}>menu add</button>
        <button onClick={() => onEdit(menu.item)}>menu edit</button>
        <button onClick={() => onDelete(menu.item)}>menu delete</button>
      </div>
    ) : null,
  EntityTableDialogs: (props: ComponentProps<typeof EntityTableDialogs>) => (
    <div>
      {props.editor && (
        <>
          <span>editor:{props.editor.mode}</span>
          <button
            onClick={() =>
              props.onSaveEditor({
                title: 'Saved',
                displayCode: null,
                description: null,
                parentId: 'parent',
              })
            }
          >
            save editor
          </button>
          <button onClick={props.onCloseEditor}>close editor</button>
        </>
      )}
      {props.deleteConfirmation && (
        <>
          <span>delete:{props.deleteConfirmation.title}</span>
          <button
            onClick={() => {
              const confirmation = props.deleteConfirmation;
              if (!confirmation) throw new Error('Expected a delete confirmation fixture');
              props.onConfirmDelete(confirmation);
            }}
          >
            confirm delete
          </button>
          <button onClick={props.onCancelDelete}>cancel delete</button>
        </>
      )}
    </div>
  ),
}));

const mockedApi = vi.mocked(api);
const mockedCursor = vi.mocked(apiCursorPage);
function item(id: string): BreakdownItem {
  return {
    id,
    entityTypeId: 'shot',
    parentId: 'parent',
    title: id,
    displayCode: null,
    description: null,
    version: 1,
    values: [],
    sourceReferences: [],
  };
}
const scene = {
  id: 'scene',
  singularName: 'Scene',
  pluralName: 'Scenes',
  level: 1,
  version: 1,
  _count: { items: 1 },
};
const shot = { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 };
const project: Project = {
  id: 'project',
  name: 'Project',
  description: null,
  ownerUserId: 'owner',
  version: 1,
  revision: 1,
  entityTypes: [scene, shot],
  roles: [],
  sourceDocuments: [],
  memberships: [],
};
const panel: Extract<WorkspacePanel, { type: 'entity_table' }> = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'entity_table' as const,
  configVersion: 1 as const,
  config: {
    entityTypeId: 'shot',
    search: 'find',
    sort: 'manual' as const,
    direction: 'asc' as const,
    filters: [{ fieldId: 'field', operator: 'equals', value: 'yes' }],
    hiddenColumns: [],
    visibleCustomFieldIds: [],
    columnWidths: {},
  },
};

function renderPanel(overrides: Partial<ComponentProps<typeof EntityTablePanel>> = {}) {
  const props = {
    project,
    projectId: 'project',
    currentUserId: 'user',
    panel,
    activeEntity: { entityType: scene, item: { ...item('parent'), entityTypeId: 'scene' } },
    onSelectEntity: vi.fn(),
    onPanelChange: vi.fn(),
    onItemOperation: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EntityTablePanel {...props} />
      </QueryClientProvider>,
    ),
    props,
  };
}

afterEach(cleanup);
beforeEach(() => {
  mockedApi.mockReset();
  mockedCursor.mockReset();
  mockedCursor.mockImplementation((url) =>
    Promise.resolve(
      String(url).includes('entityTypeId=scene')
        ? { items: [{ ...item('parent'), entityTypeId: 'scene' }], nextCursor: null }
        : { items: [item('one'), item('two')], nextCursor: null },
    ),
  );
  mockedApi.mockImplementation((url, options) => {
    if (String(url).endsWith('/fields')) return Promise.resolve([]);
    if (options?.method === 'DELETE') return Promise.resolve({ batchId: 'batch' });
    if (options?.method === 'POST') return Promise.resolve(item('created'));
    if (options?.method === 'PATCH') return Promise.resolve({ ...item('one'), version: 2 });
    return Promise.resolve(undefined);
  });
});

describe('entity table panel controller', () => {
  it('renders the hierarchy-empty state', () => {
    renderPanel({ project: { ...project, entityTypes: [] } });
    expect(screen.getByText('This breakdown has no hierarchy levels.')).toBeTruthy();
  });

  it('loads rows and wires selection, editing, menu creation, retry, paging, and resize', async () => {
    const { props } = renderPanel();
    await screen.findByText('grid:2:false:false');
    fireEvent.click(screen.getByText('select row'));
    fireEvent.click(screen.getByText('edit row'));
    expect(screen.getByText('editor:edit')).toBeTruthy();
    fireEvent.click(screen.getByText('close editor'));
    fireEvent.click(screen.getByText('open row menu'));
    fireEvent.click(screen.getByText('menu add'));
    fireEvent.click(screen.getByText('save editor'));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/projects/project/items',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    fireEvent.click(screen.getByText('retry rows'));
    fireEvent.click(screen.getByText('load rows'));
    fireEvent.pointerDown(screen.getByText('resize title'), { clientX: 10 });
    fireEvent.pointerMove(document, { clientX: 80 });
    fireEvent.pointerUp(document);
    expect(props.onSelectEntity).toHaveBeenCalled();
  });

  it('reorders and deletes rows through reversible operations', async () => {
    const { props } = renderPanel();
    await screen.findByText('grid:2:false:false');
    fireEvent.click(screen.getByText('reorder rows'));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/projects/project/items/one/reorder',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    fireEvent.click(screen.getByText('open row menu'));
    fireEvent.click(screen.getByText('menu delete'));
    expect(screen.getByText('delete:two')).toBeTruthy();
    fireEvent.click(screen.getByText('cancel delete'));
    fireEvent.click(screen.getByText('open row menu'));
    fireEvent.click(screen.getByText('menu delete'));
    fireEvent.click(screen.getByText('confirm delete'));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/api/v1/projects/project/items/two/trash',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(props.onItemOperation).toHaveBeenCalled();
  });

  it('handles keyboard panel actions and missing-parent prerequisites', async () => {
    const blockedProject = { ...project, entityTypes: [{ ...scene, _count: { items: 0 } }, shot] };
    renderPanel({ project: blockedProject, activeEntity: undefined });
    await screen.findByText('grid:2:false:false');
    await act(() =>
      window.dispatchEvent(
        new CustomEvent('coda:panel-action', {
          detail: { panelId: panel.id, action: 'add-item' },
        }),
      ),
    );
    expect(screen.getByText(/Add a Scene before adding a Shot/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Add a Scene before adding a Shot/));
    for (const action of ['select-first', 'select-next', 'select-previous', 'refresh'])
      await act(() =>
        window.dispatchEvent(
          new CustomEvent('coda:panel-action', {
            detail: { panelId: panel.id, action },
          }),
        ),
      );
  });
});
