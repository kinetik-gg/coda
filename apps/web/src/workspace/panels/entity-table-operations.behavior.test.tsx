// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import {
  useEntityTableDeletion,
  useEntityTableEditor,
  useEntityTableReorder,
} from './use-entity-table-operations';
import type { BreakdownItem, ItemOperation } from './types';

vi.mock('../../api', () => ({ api: vi.fn() }));

const mockedApi = vi.mocked(api);

function item(id: string, title = id, version = 1): BreakdownItem {
  return {
    id,
    entityTypeId: 'shot',
    parentId: 'scene',
    title,
    displayCode: null,
    description: null,
    version,
    values: [],
    sourceReferences: [],
  };
}

const type = { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 };
const panel = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'entity_table' as const,
  configVersion: 1 as const,
  config: {
    entityTypeId: 'shot',
    search: '',
    sort: 'manual' as const,
    direction: 'asc' as const,
    filters: [],
    hiddenColumns: [],
    visibleCustomFieldIds: [],
    columnWidths: {},
  },
};

afterEach(cleanup);
beforeEach(() => mockedApi.mockReset());

describe('entity table operations', () => {
  it('creates an item and supplies a reversible create operation', async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const refreshSelected = vi.fn();
    const onSelectEntity = vi.fn();
    let operation: ItemOperation | undefined;
    mockedApi.mockImplementation((url, options) => {
      if (!url) return Promise.resolve(undefined);
      if (url.endsWith('/items') && options?.method === 'POST')
        return Promise.resolve(item('created', 'Created'));
      if (url.endsWith('/trash')) return Promise.resolve({ batchId: 'batch' });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() =>
      useEntityTableEditor({
        projectId: 'project',
        type,
        invalidate,
        refreshSelected,
        onSelectEntity,
        onItemOperation: (next) => {
          operation = next;
        },
      }),
    );

    act(() => result.current.setEditor({ mode: 'create' }));
    await act(() =>
      result.current.save({
        title: 'Created',
        displayCode: null,
        description: null,
        parentId: null,
      }),
    );
    expect(refreshSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'created' }));
    await expect(operation!.redo()).rejects.toThrow('can no longer be restored');
    await act(() => operation!.undo());
    expect(onSelectEntity).toHaveBeenCalledWith(undefined);
    await act(() => operation!.redo());
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it('edits an item, supports undo and redo, and reports non-Error failures', async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const refreshSelected = vi.fn();
    let operation: ItemOperation | undefined;
    mockedApi.mockResolvedValue(item('one', 'Updated', 2));
    const { result } = renderHook(() =>
      useEntityTableEditor({
        projectId: 'project',
        type,
        invalidate,
        refreshSelected,
        onSelectEntity: vi.fn(),
        onItemOperation: (next) => {
          operation = next;
        },
      }),
    );
    act(() => result.current.setEditor({ mode: 'edit', item: item('one', 'Before') }));
    await act(() =>
      result.current.save({
        title: 'After',
        displayCode: 'A',
        description: 'D',
        parentId: 'scene',
      }),
    );
    await act(() => operation!.undo());
    await act(() => operation!.redo());
    expect(mockedApi).toHaveBeenCalledTimes(3);

    act(() => result.current.setEditor({ mode: 'create' }));
    mockedApi.mockRejectedValueOnce('offline');
    await act(() =>
      result.current.save({ title: 'Nope', displayCode: null, description: null, parentId: null }),
    );
    expect(result.current.error).toBe('The item could not be saved.');
  });

  it('moves an item to trash, chooses neighboring selections, and reverses the operation', async () => {
    const visibleItems = [item('a'), item('b'), item('c')];
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const refreshSelected = vi.fn();
    const onSelectEntity = vi.fn();
    const onDeleted = vi.fn();
    let operation: ItemOperation | undefined;
    mockedApi.mockImplementation((url) =>
      Promise.resolve(
        url?.endsWith('/trash') ? { batchId: `batch-${mockedApi.mock.calls.length}` } : undefined,
      ),
    );
    const { result } = renderHook(() =>
      useEntityTableDeletion({
        projectId: 'project',
        visibleItems,
        invalidate,
        refreshSelected,
        onSelectEntity,
        onDeleted,
        onItemOperation: (next) => {
          operation = next;
        },
      }),
    );
    act(() => result.current.setConfirmation(visibleItems[1]));
    await act(() => result.current.trash(visibleItems[1]!));
    expect(refreshSelected).toHaveBeenCalledWith(visibleItems[2]);
    expect(onDeleted).toHaveBeenCalled();
    await act(() => operation!.undo());
    expect(refreshSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', version: 3 }));
    await act(() => operation!.redo());
    expect(refreshSelected).toHaveBeenCalledWith(visibleItems[0]);
  });

  it('clears selection for a lone deletion and surfaces deletion errors', async () => {
    const only = item('only');
    const onSelectEntity = vi.fn();
    mockedApi.mockResolvedValueOnce({ batchId: 'batch' });
    const { result } = renderHook(() =>
      useEntityTableDeletion({
        projectId: 'project',
        visibleItems: [only],
        invalidate: vi.fn().mockResolvedValue(undefined),
        refreshSelected: vi.fn(),
        onSelectEntity,
        onItemOperation: undefined,
        onDeleted: vi.fn(),
      }),
    );
    await act(() => result.current.trash(only));
    expect(onSelectEntity).toHaveBeenCalledWith(undefined);
    mockedApi.mockRejectedValueOnce('offline');
    await act(() => result.current.trash(only));
    expect(result.current.error).toBe('The item could not be moved to trash.');
  });

  it('reorders rows and makes the saved move reversible', async () => {
    const visibleItems = [item('a'), item('b'), item('c')];
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const refreshSelected = vi.fn();
    const setOrderedItems = vi.fn();
    let operation: ItemOperation | undefined;
    mockedApi.mockImplementation((_url, options) => {
      if (typeof options?.body !== 'string') return Promise.resolve(undefined);
      const body = JSON.parse(options.body) as { version: number };
      return Promise.resolve(item('a', 'a', body.version + 1));
    });
    const { result } = renderHook(() =>
      useEntityTableReorder({
        projectId: 'project',
        type,
        panel,
        visibleItems,
        setOrderedItems,
        invalidate,
        refreshSelected,
        onRefetch: vi.fn(),
        onItemOperation: (next) => {
          operation = next;
        },
      }),
    );
    await act(() => result.current.reorder({ active: { id: 'a' }, over: { id: 'c' } } as never));
    expect(setOrderedItems).toHaveBeenCalledWith([
      visibleItems[1],
      visibleItems[2],
      visibleItems[0],
    ]);
    await act(() => operation!.undo());
    await act(() => operation!.redo());
    expect(refreshSelected).toHaveBeenCalledTimes(3);

    await act(() => result.current.reorder({ active: { id: 'a' }, over: null } as never));
    expect(mockedApi).toHaveBeenCalledTimes(3);
  });

  it('rolls back optimistic order after an API failure', async () => {
    const setOrderedItems = vi.fn();
    const onRefetch = vi.fn();
    mockedApi.mockRejectedValueOnce(new Error('conflict'));
    const { result } = renderHook(() =>
      useEntityTableReorder({
        projectId: 'project',
        type,
        panel,
        visibleItems: [item('a'), item('b')],
        setOrderedItems,
        invalidate: vi.fn().mockResolvedValue(undefined),
        refreshSelected: vi.fn(),
        onRefetch,
        onItemOperation: vi.fn(),
      }),
    );
    await act(() => result.current.reorder({ active: { id: 'a' }, over: { id: 'b' } } as never));
    expect(result.current.error).toBe('conflict');
    expect(setOrderedItems).toHaveBeenLastCalledWith(undefined);
    expect(onRefetch).toHaveBeenCalled();
  });
});
