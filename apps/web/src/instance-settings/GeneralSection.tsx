import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { SectionPlaceholder } from './SectionPlaceholder';

export function GeneralSection() {
  return (
    <SectionPlaceholder
      icon={<GearSixIcon size={22} aria-hidden="true" />}
      title="General settings are coming soon."
    >
      Instance identity, defaults, and instance-wide preferences will land here.
    </SectionPlaceholder>
  );
}
