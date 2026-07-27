import { DatabaseIcon } from '@phosphor-icons/react/dist/csr/Database';
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/csr/WarningOctagon';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedEntityType, SectionId } from './types';

const navItems: Array<{
  id: SectionId;
  label: string;
  icon: typeof GitBranchIcon;
}> = [
  { id: 'share', label: 'Share', icon: UsersThreeIcon },
  { id: 'details', label: 'Details', icon: PencilSimpleIcon },
  { id: 'structure', label: 'Entities & fields', icon: GitBranchIcon },
  { id: 'data', label: 'Data operations', icon: DatabaseIcon },
  { id: 'danger', label: 'Danger zone', icon: WarningOctagonIcon },
];

export function ProjectManagementNavigation({
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
    <div className={styles.sidebarNav}>
      {navItems.map(({ id, label, icon: Icon }) => (
        <div className={styles.sidebarGroup} key={id}>
          <button
            type="button"
            className={styles.sidebarButton}
            aria-current={section === id ? 'page' : undefined}
            aria-expanded={id === 'structure' ? section === 'structure' : undefined}
            onClick={() => onSelectSection(id)}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{label}</span>
          </button>
          {id === 'structure' && section === 'structure' && (
            <div className={styles.sidebarSubNav} aria-label="Entity levels">
              {entityTypes.map((entityType) => (
                <button
                  key={entityType.id}
                  type="button"
                  className={styles.sidebarSubItem}
                  aria-current={selectedEntityTypeId === entityType.id ? 'page' : undefined}
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
    </div>
  );
}
