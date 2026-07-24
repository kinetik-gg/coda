import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { SectionPlaceholder } from './SectionPlaceholder';

export function StorageSection() {
  return (
    <SectionPlaceholder
      icon={<HardDrivesIcon size={22} aria-hidden="true" />}
      title="Storage settings are coming soon."
    >
      The storage settings wizard will let you choose and hot-swap the object storage backend for
      uploads, with credentials encrypted at rest.
    </SectionPlaceholder>
  );
}
