// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrackerRecord,
  deleteTrackerRecords,
  setTrackerRecordFieldValue,
  updateTrackerRecord,
} from '../../api';
import { useTrackerRecordOperations } from './use-tracker-record-operations';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import type { ItemOperation } from './types';

vi.mock('../../api', () => ({
  api: vi.fn(),
  ApiError: Error,
  createTrackerRecord: vi.fn(),
  deleteTrackerRecords: vi.fn(),
  setTrackerRecordFieldValue: vi.fn(),
  updateTrackerRecord: vi.fn(),
}));

const mockedCreate = vi.mocked(createTrackerRecord);
const mockedDelete = vi.mocked(deleteTrackerRecords);
const mockedSetValue = vi.mocked(setTrackerRecordFieldValue);
const mockedUpdate = vi.mocked(updateTrackerRecord);

function record(id: string, title = id, version = 1): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title,
    position: `a${id}`,
    version,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    values: [],
  };
}

const textField: TrackerField = {
  id: 'f1',
  name: 'Location',
  key: 'location',
  type: 'text',
  required: false,
  version: 1,
  options: [],
};

const imageField: TrackerField = {
  id: 'f-img',
  name: 'Art',
  key: 'art',
  type: 'image',
  required: false,
  version: 1,
  options: [],
};

function base(overrides?: Partial<Parameters<typeof useTrackerRecordOperations>[0]>) {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const onRefetch = vi.fn();
  const refreshSelected = vi.fn();
  const onSelectRecord = vi.fn();
  let ordered: TrackerRecord[] | undefined;
  const setOrderedItems = (value: TrackerRecord[] | ((current: TrackerRecord[] | undefined) => TrackerRecord[])) => {
    ordered = typeof value === 'function' ? value(ordered) : value;
  };
  return {
    args: {
      trackerId: 't1',
      canEdit: true,
      panelSort: 'manual',
      visibleRecords: [record('a'), record('b'), record('c')],
      setOrderedItems,
      invalidate,
      refreshSelected,
      onSelectRecord,
      onItemOperation: undefined,
      onRefetch,
      ...overrides,
    },
    invalidate,
    getOrdered: () => ordered,
  };
}

const renderOperations = (props: Parameters<typeof useTrackerRecordOperations>[0]) =>
  renderHook(() => useTrackerRecordOperations(props), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    ),
  });

afterEach(cleanup);
beforeEach(() => {
  [mockedCreate, mockedDelete, mockedSetValue, mockedUpdate].forEach((fn) => fn.mockReset());
});

describe('tracker record operations', () => {
  it('renames a record and restores the old title on undo, re-applies on redo', async () => {
    let operation: ItemOperation | undefined;
    const setup = base({
      onItemOperation: (next) => {
        operation = next;
      },
    });
    mockedUpdate.mockResolvedValue(record('a', 'After', 2));
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.editTitle(record('a', 'Before'), 'After');
    });
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'a', title: 'After', version: 1 }),
    );
    // Undo sends the old title at the version the server returned.
    mockedUpdate.mockResolvedValue(record('a', 'Before', 3));
    await act(async () => operation!.undo());
    expect(mockedUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ recordId: 'a', title: 'Before', version: 2 }),
    );
    // Redo re-sends the new title chained off the undo response.
    mockedUpdate.mockResolvedValue(record('a', 'After', 4));
    await act(async () => operation!.redo());
    expect(mockedUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ recordId: 'a', title: 'After', version: 3 }),
    );
  });

  it('writes a cell value with the stored value as its inverse', async () => {
    let operation: ItemOperation | undefined;
    const row: TrackerRecord = {
      ...record('a'),
      values: [
        {
          fieldId: 'f1',
          textValue: 'Old',
          integerValue: null,
          floatValue: null,
          booleanValue: null,
          dateValue: null,
          options: [],
        },
      ],
    };
    const setup = base({
      visibleRecords: [row, record('b'), record('c')],
      onItemOperation: (next) => {
        operation = next;
      },
    });
    mockedSetValue.mockResolvedValue(row);
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.setCell(row, textField, { type: 'text', value: 'New' });
    });
    expect(mockedSetValue).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: 'f1',
        value: { type: 'text', value: 'New' },
        recordVersion: 1,
      }),
    );
    await act(async () => operation!.undo());
    expect(mockedSetValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: { type: 'text', value: 'Old' } }),
    );
    await act(async () => operation!.redo());
    expect(mockedSetValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: { type: 'text', value: 'New' } }),
    );
  });

  it('writes a media value with the previous objectId as its undo inverse', async () => {
    let operation: ItemOperation | undefined;
    const row: TrackerRecord = {
      ...record('a'),
      values: [
        {
          fieldId: imageField.id,
          textValue: null,
          integerValue: null,
          floatValue: null,
          booleanValue: null,
          dateValue: null,
          options: [],
          storageObjectId: 'old-object',
        },
      ],
    };
    const setup = base({
      visibleRecords: [row, record('b'), record('c')],
      onItemOperation: (next) => {
        operation = next;
      },
    });
    mockedSetValue.mockResolvedValue(row);
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.setCell(row, imageField, {
        type: 'image',
        storageObjectId: 'new-object',
      });
    });
    expect(mockedSetValue).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: 'f-img',
        value: { type: 'image', storageObjectId: 'new-object' },
        recordVersion: 1,
      }),
    );
    // Undo restores the replaced object id; redo re-applies the upload.
    await act(async () => operation!.undo());
    expect(mockedSetValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: { type: 'image', storageObjectId: 'old-object' } }),
    );
    await act(async () => operation!.redo());
    expect(mockedSetValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: { type: 'image', storageObjectId: 'new-object' } }),
    );
  });

  it('reorders optimistically and registers a move pair that chains versions', async () => {
    let operation: ItemOperation | undefined;
    const rows = [record('a'), record('b'), record('c')];
    const setup = base({
      visibleRecords: rows,
      onItemOperation: (next) => {
        operation = next;
      },
    });
    mockedUpdate.mockResolvedValue(record('a', 'a', 2));
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.reorderRecord(rows[0]!, 2);
    });
    expect(setup.getOrdered()?.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'a', beforeId: null, afterId: 'c', version: 1 }),
    );
    // Undo moves back to the original gap at the new version.
    mockedUpdate.mockResolvedValue(record('a', 'a', 3));
    await act(async () => operation!.undo());
    expect(mockedUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ beforeId: 'b', afterId: null, version: 2 }),
    );
    await act(async () => operation!.redo());
    expect(mockedUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ beforeId: null, afterId: 'c', version: 3 }),
    );
  });

  it('creates a record whose undo deletes it and whose redo recreates it in place', async () => {
    const operations: ItemOperation[] = [];
    const setup = base({
      onItemOperation: (next) => {
        operations.push(next);
      },
    });
    mockedCreate.mockResolvedValue(record('new'));
    mockedDelete.mockResolvedValue({ deletedIds: ['new'], deletionBatchId: 'batch-1' });
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.createRecord('Fresh', { afterId: 'a' });
    });
    expect(operations[0]!.label).toBe('Create record');
    expect(mockedCreate).toHaveBeenCalledWith({
      trackerId: 't1',
      title: 'Fresh',
      afterId: 'a',
    });
    await act(async () => operations[0]!.undo());
    expect(mockedDelete).toHaveBeenCalledWith({ trackerId: 't1', ids: ['new'] });
    expect(setup.args.onSelectRecord).toHaveBeenCalledWith(undefined);
    await act(async () => operations[0]!.redo());
    // The redo recreates the row at the same manual slot.
    expect(mockedCreate).toHaveBeenLastCalledWith({
      trackerId: 't1',
      title: 'Fresh',
      afterId: 'a',
    });
  });

  it('deletes records and undoes by recreating them between their former neighbours', async () => {
    let operation: ItemOperation | undefined;
    const rows = [record('a'), record('b'), record('c')];
    const setup = base({
      visibleRecords: rows,
      onItemOperation: (next) => {
        operation = next;
      },
    });
    mockedDelete.mockResolvedValue({ deletedIds: ['b'], deletionBatchId: 'batch-9' });
    mockedCreate.mockResolvedValue(record('b-new', 'b'));
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await act(async () => {
      await result.current.deleteRecords([rows[1]!]);
    });
    expect(operation!.label).toBe('Delete record');
    await act(async () => operation!.undo());
    // Restored between former neighbours a and c.
    expect(mockedCreate).toHaveBeenCalledWith({
      trackerId: 't1',
      title: 'b',
      beforeId: 'c',
      afterId: 'a',
    });
  });

  it('blocks edits without permission', async () => {
    const setup = base({ canEdit: false });
    const { result } = renderOperations(
      setup.args as Parameters<typeof useTrackerRecordOperations>[0],
    );
    await expect(result.current.editTitle(record('a'), 'X')).rejects.toThrow('permission');
    await expect(
      result.current.setCell(record('a'), textField, { type: 'text', value: 'x' }),
    ).rejects.toThrow('permission');
    await act(async () => result.current.createRecord('Nope'));
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
