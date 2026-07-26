import { Skeleton } from '../components/Skeleton';
import { WorkspaceLoadingSkeleton } from '../workspace/WorkspaceLoadingSkeleton';
import styles from '../App.styles';

export function WorkspaceRouteLoadingSkeleton() {
  return (
    <div className={`${styles.shell} ${styles.editorShell}`} aria-busy="true">
      <header className={styles.masthead}>
        <div className={styles.appMenus}>
          <Skeleton width={50} height={18} radius={2} />
          <Skeleton width={188} height={12} />
        </div>
        <Skeleton width={190} height={28} radius={4} />
      </header>
      <WorkspaceLoadingSkeleton />
    </div>
  );
}
