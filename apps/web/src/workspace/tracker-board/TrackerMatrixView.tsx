import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Skeleton } from '../../components/Skeleton';
import type { TrackerRecord } from '../../trackers/types';
import {
  visibleChips,
  matrixCellKey,
  type MatrixCell,
  type MatrixModel,
} from './matrix-model';
import styles from './TrackerMatrix.module.css';

function CellRecordsPopover({
  anchor,
  cell,
  onSelect,
  onClose,
}: {
  anchor: HTMLButtonElement;
  cell: MatrixCell;
  onSelect: (record: TrackerRecord) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const bounds = anchor.getBoundingClientRect();
    setPosition({ left: bounds.left, top: bounds.bottom + 3 });
  }, [anchor]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', keyboard);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${cell.records.length} records in this cell`}
      className={styles.recordsPopover}
      style={position}
    >
      <span className={styles.recordsPopoverTitle}>{cell.records.length} RECORDS</span>
      {cell.records.map((record) => (
        <button
          key={record.id}
          type="button"
          className={styles.recordLink}
          title={`Select ${record.title}`}
          onClick={() => {
            onSelect(record);
            onClose();
          }}
        >
          {record.title}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function MatrixCellView({
  cell,
  onSelect,
}: {
  cell: MatrixCell | undefined;
  onSelect: (record: TrackerRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  if (!cell || cell.records.length === 0) {
    return <td className={`${styles.matrixCell} ${styles.matrixEmptyCell}`} aria-label="Empty" />;
  }
  const chips = visibleChips(cell);
  const hiddenCount = cell.records.length - chips.length;
  return (
    <td className={styles.matrixCell}>
      <span className={styles.cellCount}>{cell.records.length}</span>
      {chips.map((record) => (
        <span key={record.id} className={styles.cellChip} title={record.title}>
          {record.title}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className={styles.popoverAnchor}>
          <button
            ref={moreRef}
            type="button"
            className={styles.cellMore}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((value) => !value)}
          >
            +{hiddenCount} more
          </button>
          {open && moreRef.current && (
            <CellRecordsPopover
              anchor={moreRef.current}
              cell={cell}
              onSelect={onSelect}
              onClose={() => setOpen(false)}
            />
          )}
        </span>
      )}
    </td>
  );
}

/**
 * The tracker pivot surface: row-option × col-option cells aggregating matching records with a
 * count, compact title chips capped at {@link MATRIX_CHIP_CAP}, and a "+N more" popover listing
 * the whole cell whose entries select the record back in the grid. Sticky headers plus sticky
 * leading axis column keep totals readable while scrolling.
 */
export function TrackerMatrixView({
  model,
  axisLabel,
  loading,
  error,
  hasMore,
  loadingMore,
  onSelect,
  onLoadMore,
  onRetry,
}: {
  model: MatrixModel;
  axisLabel: string;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (record: TrackerRecord) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className={styles.queryState} role="alert">
        <span>The matrix could not be loaded.</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <>
      <div className={styles.matrixScroll}>
        <table className={styles.matrix} aria-busy={loading}>
          <thead>
            <tr>
              <th scope="col" className={styles.axisCorner} aria-label={axisLabel}>
                {axisLabel}
              </th>
              {model.cols.map((col) => (
                <th key={col.id} scope="col">
                  {col.label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              [0, 1, 2].map((rowIndex) => (
                <tr key={rowIndex}>
                  <td className={styles.axisHeader}>
                    <Skeleton width="70%" height={9} />
                  </td>
                  {[0, 1, 2].map((cellIndex) => (
                    <td key={cellIndex}>
                      <Skeleton width="55%" height={9} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            {!loading &&
              model.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className={styles.axisHeader}>
                    {row.label}
                  </th>
                  {model.cols.map((col) => (
                    <MatrixCellView
                      key={col.id}
                      cell={model.cells.get(matrixCellKey(row.id, col.id))}
                      onSelect={onSelect}
                    />
                  ))}
                  <td className={styles.matrixTotal}>{model.rowTotals.get(row.id) ?? 0}</td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={styles.axisHeader}>
                Total
              </th>
              {model.cols.map((col) => (
                <td key={col.id} className={styles.matrixTotal}>
                  {model.colTotals.get(col.id) ?? 0}
                </td>
              ))}
              <td className={styles.matrixTotal}>{model.grandTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!loading && !error && hasMore && (
        <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? 'Loading more…' : 'Load more records'}
        </button>
      )}
    </>
  );
}
