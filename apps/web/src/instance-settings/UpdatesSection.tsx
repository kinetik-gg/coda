import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { SectionPlaceholder } from './SectionPlaceholder';

export function UpdatesSection() {
  return (
    <SectionPlaceholder
      icon={<ArrowsClockwiseIcon size={22} aria-hidden="true" />}
      title="Updates are coming soon."
    >
      Release checks, upgrade notes, and the opt-in upgrade ceremony with a backup gate will land
      here.
    </SectionPlaceholder>
  );
}
