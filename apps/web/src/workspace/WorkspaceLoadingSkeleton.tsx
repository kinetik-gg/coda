import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import styles from './DenseWorkspace.module.css';

function PanelHeaderSkeleton({ pdf = false }: { pdf?: boolean }) {
  return (
    <div className={styles.openingHeader}>
      <Skeleton width={pdf ? 98 : 106} height={26} radius={4} />
      <Skeleton width={28} height={8} />
      <Skeleton width={32} height={8} />
      <Skeleton width={24} height={8} />
      <span className={styles.openingHeaderSpacer} />
      <Skeleton width={26} height={26} radius={4} />
      <Skeleton width={26} height={26} radius={4} />
    </div>
  );
}

function TablePanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className={styles.openingPanel}>
      <PanelHeaderSkeleton />
      <div className={styles.openingTable}>
        <div className={styles.openingTableHead}>
          <Skeleton width={30} height={8} />
          <Skeleton width={44} height={8} />
          <Skeleton width={72} height={8} />
          <Skeleton width={38} height={8} />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={styles.openingTableRow}>
            <Skeleton width={12} height={12} radius={2} />
            <Skeleton width={index % 3 === 0 ? 42 : 54} height={9} />
            <Skeleton width={index % 2 ? '68%' : '82%'} height={9} />
            <Skeleton width={index % 3 ? 22 : 30} height={9} />
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorPanelSkeleton() {
  return (
    <div className={styles.openingPanel}>
      <PanelHeaderSkeleton />
      <div className={styles.openingInspector}>
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index}>
            <Skeleton width={index % 3 === 0 ? 54 : 70} height={8} />
            <Skeleton width={index % 2 ? '58%' : '82%'} height={9} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceLoadingSkeleton() {
  return (
    <div className={styles.workspaceLoadingShell} aria-busy="true">
      <SkeletonGroup label="Opening workspace" className={styles.workspaceOpening}>
        <div className={`${styles.openingColumn} ${styles.openingLeftColumn}`}>
          <TablePanelSkeleton rows={3} />
          <TablePanelSkeleton rows={8} />
        </div>
        <div className={styles.openingColumn}>
          <TablePanelSkeleton rows={9} />
          <InspectorPanelSkeleton />
        </div>
        <div className={`${styles.openingPanel} ${styles.openingPdf}`}>
          <PanelHeaderSkeleton pdf />
          <div className={styles.openingPdfBody}>
            <Skeleton width="82%" height="94%" radius={1} />
          </div>
        </div>
      </SkeletonGroup>
      <div className={styles.openingStatus} role="status" aria-live="polite">
        <SpinnerGapIcon size={12} className={styles.spin} aria-hidden="true" /> LOADING
      </div>
    </div>
  );
}
