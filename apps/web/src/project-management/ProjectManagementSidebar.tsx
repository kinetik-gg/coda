import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings';
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedEntityType, SectionId } from './types';

const navItems: Array<{
  id: SectionId;
  label: string;
  icon: typeof BuildingsIcon;
}> = [
  { id: 'overview', label: 'Overview', icon: BuildingsIcon },
  { id: 'entities', label: 'Entities', icon: GitBranchIcon },
  { id: 'danger', label: 'Danger', icon: WarningIcon },
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
    <aside className={styles.sidebar} aria-label="Project management pages">
      <nav className={styles.sidebarNav} aria-label="Project management sections">
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
