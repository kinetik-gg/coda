import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope';
import { SectionPlaceholder } from './SectionPlaceholder';

export function DoctorSection() {
  return (
    <SectionPlaceholder
      icon={<StethoscopeIcon size={22} aria-hidden="true" />}
      title="The instance doctor is coming soon."
    >
      A sanitized diagnostic report covering every new failure mode will land here.
    </SectionPlaceholder>
  );
}
