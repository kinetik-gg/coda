import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedEntityType, SectionId } from './types';

const navItems: Array<{
  id: SectionId;
  label: string;
  icon: typeof GitBranchIcon;
}> = [
  { id: 'entities', label: 'Entities', icon: GitBranchIcon },
  // Danger retired with #176: moving a breakdown to trash is a confirmation raised from the
  // library row menu and the inspector, not a section of a page. What remains here is import and
  // export, which are tools rather than destructive acts.
  { id: 'data', label: 'Data', icon: DatabaseIcon },
];

export function ProjectManagementSidebar({
  section,
  entityTypes,
  selectedEntityTypeId,
  onSelectSection,
  onSelectEntityType,
}: {
  section: SectionId;
  entityTypes: ManagedEntityType[];
  selectedEntityTypeId: string;
  onSelectSection: (section: SectionId) => void;
  onSelectEntityType: (entityTypeId: string) => void;
}) {
  return (
    <aside className={styles.sidebar} aria-label="Breakdown management pages">
      <nav className={styles.sidebarNav} aria-label="Breakdown management sections">
        {navItems.map(({ id, label, icon: Icon }) => (
          <div className={styles.sidebarGroup} key={id}>
            <button
              type="button"
              className={styles.sidebarButton}
              aria-current={section === id ? 'page' : undefined}
              aria-expanded={id === 'entities' ? section === 'entities' : undefined}
              onClick={() => onSelectSection(id)}
            >
              <Icon size={12} aria-hidden="true" />
              <span>{label}</span>
            </button>
            {id === 'entities' && (
              <div className={styles.sidebarSubNav} aria-label="Entity levels">
                {entityTypes.map((entityType) => (
                  <button
                    key={entityType.id}
                    type="button"
                    className={styles.sidebarSubItem}
                    aria-current={
                      section === 'entities' && selectedEntityTypeId === entityType.id
                        ? 'page'
                        : undefined
                    }
                    onClick={() => onSelectEntityType(entityType.id)}
                  >
                    <span>Level {entityType.level}</span>
                    <strong>{entityType.pluralName}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
