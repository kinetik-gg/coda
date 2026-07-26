import { useCallback, useState } from 'react';

export interface RowSelection<T> {
  /** The identity of the selected row, or `undefined` when nothing is selected. */
  selectedId: string | undefined;
  /** The selected row, resolved against the current rows (filtering/deletion aware). */
  selected: T | undefined;
  select: (row: T) => void;
  clear: () => void;
  /** Pass straight to `DataTable`'s `isSelected`. */
  isSelected: (row: T) => boolean;
}

/**
 * Single-row selection for a content list, driving the inspector pane.
 *
 * Selection is stored as an identity rather than a row object and resolved
 * against the live rows on every render, so a row that leaves the list — search
 * filtered, trashed, renamed by another client — empties the inspector instead
 * of pinning a stale snapshot.
 */
export function useRowSelection<T>({
  rows,
  rowKey,
}: {
  rows: readonly T[];
  rowKey: (row: T) => string;
}): RowSelection<T> {
  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    selectedId === undefined ? undefined : rows.find((row) => rowKey(row) === selectedId);

  const select = useCallback((row: T) => setSelectedId(rowKey(row)), [rowKey]);
  const clear = useCallback(() => setSelectedId(undefined), []);
  const isSelected = useCallback(
    (row: T) => selectedId !== undefined && rowKey(row) === selectedId,
    [rowKey, selectedId],
  );

  return { selectedId, selected, select, clear, isSelected };
}
