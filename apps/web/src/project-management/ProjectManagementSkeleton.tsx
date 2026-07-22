import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import styles from '../ProjectManagementScreen.styles';

export function ProjectManagementSkeleton() {
  return (
    <main className={styles.page} aria-busy="true">
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-hidden="true">
          <div className={styles.sidebarSkeleton}>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} width={index > 1 && index < 4 ? '62%' : '78%'} height={12} />
            ))}
          </div>
        </aside>
        <SkeletonGroup label="Loading project management" className={styles.content}>
          <div className={styles.pageIntro}>
            <Skeleton width={210} height={25} />
            <Skeleton width="55%" height={10} />
          </div>
          <section className={styles.card}>
            <Skeleton width={140} height={16} />
            <div className={styles.formGrid}>
              <Skeleton height={34} />
              <Skeleton height={84} />
              <Skeleton width={120} height={32} />
            </div>
          </section>
          <section className={styles.card}>
            <Skeleton width={170} height={16} />
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} height={48} />
            ))}
          </section>
        </SkeletonGroup>
      </div>
    </main>
  );
}
