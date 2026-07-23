import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import { messages } from '../messages';
import styles from '../ProjectsScreen.module.css';
import type { Project, ProjectsPage, TrashedProject } from './types';

export function ProjectsSidebar({
  activePage,
  onPageChange,
}: {
  activePage: ProjectsPage;
  onPageChange: (page: ProjectsPage) => void;
}) {
  return (
    <aside className={styles.sidebar} aria-label="Breakdown pages">
      <nav className={styles.sidebarNav}>
        <button
          type="button"
          className={styles.sidebarItem}
          aria-current={activePage === 'overview' ? 'page' : undefined}
          onClick={() => onPageChange('overview')}
        >
          <FolderOpenIcon size={12} aria-hidden="true" />
          <span>Overview</span>
        </button>
        <button
          type="button"
          className={styles.sidebarItem}
          aria-current={activePage === 'deleted' ? 'page' : undefined}
          onClick={() => onPageChange('deleted')}
        >
          <TrashIcon size={12} aria-hidden="true" />
          <span>Trash</span>
        </button>
      </nav>
    </aside>
  );
}

export function ProjectsHeader({
  activePage,
  onCreate,
}: {
  activePage: ProjectsPage;
  onCreate: () => void;
}) {
  const overview = activePage === 'overview';
  return (
    <header className={styles.contentHeader}>
      <div>
        <h1>{overview ? 'Breakdowns' : 'Trash'}</h1>
        <p>
          {overview
            ? 'Open breakdowns you own or collaborate on.'
            : 'Restore owned breakdowns before their 30-day retention period ends.'}
        </p>
      </div>
      {overview && (
        <button className={styles.primaryButton} type="button" onClick={onCreate}>
          <PlusIcon size={12} weight="bold" aria-hidden="true" />
          {messages.newProject}
        </button>
      )}
    </header>
  );
}

function ProjectRow({
  project,
  onOpen,
  onManage,
}: {
  project: Project;
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const canManage = project.currentMembership?.role.permissions.some(
    (entry) => entry.permission === 'manage_project_settings',
  );
  return (
    <article className={styles.projectRow}>
      <button className={styles.projectMain} type="button" onClick={() => onOpen(project.id)}>
        <span className={styles.projectCopy}>
          <strong>{project.name}</strong>
          <span>{project.description || 'No breakdown description yet.'}</span>
        </span>
        <span className={styles.updatedAt}>
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </span>
        <ArrowRightIcon size={13} aria-hidden="true" />
      </button>
      {canManage && (
        <button className={styles.manageButton} type="button" onClick={() => onManage(project.id)}>
          <GearSixIcon size={12} aria-hidden="true" />
          Manage
        </button>
      )}
    </article>
  );
}

function ProjectSection({
  title,
  description,
  projects,
  emptyTitle,
  emptyDescription,
  onOpen,
  onManage,
}: {
  title: string;
  description: string;
  projects: Project[];
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const titleId = `${title.toLowerCase().replaceAll(' ', '-')}-title`;
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{projects.length}</span>
      </div>
      {projects.length ? (
        <div className={styles.projectList}>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} onOpen={onOpen} onManage={onManage} />
          ))}
        </div>
      ) : (
        <div className={styles.sectionEmpty}>
          <FolderOpenIcon size={18} aria-hidden="true" />
          <div>
            <strong>{emptyTitle}</strong>
            <p>{emptyDescription}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectsSkeleton() {
  return (
    <SkeletonGroup label="Loading breakdowns" className={styles.sections}>
      {Array.from({ length: 2 }, (_, sectionIndex) => (
        <section className={styles.section} key={sectionIndex}>
          <div className={styles.sectionHeader}>
            <div>
              <Skeleton width={sectionIndex ? 106 : 82} height={14} />
              <Skeleton width={220} height={9} />
            </div>
          </div>
          <div className={styles.projectList}>
            {Array.from({ length: sectionIndex ? 1 : 3 }, (_, rowIndex) => (
              <div className={styles.projectRowSkeleton} key={rowIndex}>
                <span>
                  <Skeleton width={rowIndex % 2 ? '42%' : '58%'} height={11} />
                  <Skeleton width="74%" height={9} />
                </span>
                <Skeleton width={82} height={9} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </SkeletonGroup>
  );
}

export function ProjectsOverview({
  loading,
  failed,
  owned,
  shared,
  onRetry,
  onOpen,
  onManage,
}: {
  loading: boolean;
  failed: boolean;
  owned: Project[];
  shared: Project[];
  onRetry: () => void;
  onOpen: (id: string) => void;
  onManage: (id: string) => void;
}) {
  if (loading) return <ProjectsSkeleton />;
  if (failed) {
    return (
      <section className={styles.pageEmpty} role="alert">
        <FolderOpenIcon size={20} aria-hidden="true" />
        <h2>Breakdowns could not be loaded.</h2>
        <p>Check the service connection, then try again.</p>
        <button type="button" className={styles.secondaryButton} onClick={onRetry}>
          Try again
        </button>
      </section>
    );
  }
  return (
    <div className={styles.sections}>
      <ProjectSection
        title="My breakdowns"
        description="Breakdowns you own and manage."
        projects={owned}
        emptyTitle="No breakdowns of your own"
        emptyDescription="Create a breakdown to analyze a source document."
        onOpen={onOpen}
        onManage={onManage}
      />
      <ProjectSection
        title="Shared with me"
        description="Breakdowns where you are a collaborator."
        projects={shared}
        emptyTitle="Nothing shared with you"
        emptyDescription="Breakdowns appear here after an owner adds you as a collaborator."
        onOpen={onOpen}
        onManage={onManage}
      />
    </div>
  );
}

function TrashSkeleton() {
  return (
    <SkeletonGroup
      label="Loading deleted breakdowns"
      className={`${styles.section} ${styles.trashSection}`}
    >
      <div className={styles.projectList}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={styles.projectRowSkeleton}>
            <span>
              <Skeleton width={index % 2 ? '46%' : '60%'} height={11} />
              <Skeleton width={210} height={9} />
            </span>
            <Skeleton width={70} height={28} radius={4} />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

export function ProjectsTrash({
  loading,
  failed,
  projects,
  restoringProjectId,
  mutationPending,
  restoreFailed,
  onRetry,
  onRestore,
  onPurge,
}: {
  loading: boolean;
  failed: boolean;
  projects: TrashedProject[];
  restoringProjectId?: string;
  mutationPending: boolean;
  restoreFailed: boolean;
  onRetry: () => void;
  onRestore: (id: string) => void;
  onPurge: (project: TrashedProject) => void;
}) {
  if (loading) return <TrashSkeleton />;
  if (failed) {
    return (
      <section className={styles.pageEmpty} role="alert">
        <TrashIcon size={20} aria-hidden="true" />
        <h2>Deleted breakdowns could not be loaded.</h2>
        <p>Check the service connection, then try again.</p>
        <button type="button" className={styles.secondaryButton} onClick={onRetry}>
          Try again
        </button>
      </section>
    );
  }
  if (!projects.length) {
    return (
      <section className={styles.pageEmpty}>
        <TrashIcon size={20} aria-hidden="true" />
        <h2>No deleted breakdowns</h2>
        <p>Breakdowns moved to trash will remain recoverable here for 30 days.</p>
      </section>
    );
  }
  return (
    <section
      className={`${styles.section} ${styles.trashSection}`}
      aria-label="Recoverable breakdowns"
    >
      <div className={styles.projectList}>
        {projects.map((project) => (
          <article key={project.id} className={styles.deletedRow}>
            <span className={styles.projectCopy}>
              <strong>{project.name}</strong>
              <span>Permanently removed {new Date(project.purgeAfter).toLocaleDateString()}</span>
            </span>
            {project.canRestore ? (
              <span className={styles.deletedActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={mutationPending}
                  onClick={() => onRestore(project.id)}
                >
                  <ArrowCounterClockwiseIcon size={12} aria-hidden="true" />
                  {restoringProjectId === project.id ? 'Restoring…' : 'Restore'}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={mutationPending}
                  onClick={() => onPurge(project)}
                >
                  <TrashIcon size={12} aria-hidden="true" /> Delete permanently…
                </button>
              </span>
            ) : (
              <span className={styles.ownerOnly}>Owner only</span>
            )}
          </article>
        ))}
      </div>
      {restoreFailed && (
        <p className={styles.inlineError} role="alert">
          The breakdown could not be restored. Please try again.
        </p>
      )}
    </section>
  );
}
