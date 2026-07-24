import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { SectionPlaceholder } from './SectionPlaceholder';

export function BackupsSection() {
  return (
    <SectionPlaceholder
      icon={<ArchiveIcon size={22} aria-hidden="true" />}
      title="Backups are coming soon."
    >
      Downloadable, restorable, and scheduled signed backups with rolling retention will land here.
    </SectionPlaceholder>
  );
}
