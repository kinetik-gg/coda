import { lazy, Suspense } from 'react';
import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope';
import { instanceSettingsSectionPath } from '../app-routing';
import { resolveRailCrumbs } from '../app-shell/nav-model';
import { PanelHeader } from '../app-shell/PanelHeader';
import type { InstanceSettingsSection } from './types';
import styles from './InstanceSettingsScreen.module.css';

export type { InstanceSettingsSection } from './types';

// Each panel is its own lazily-loaded chunk with a stable module boundary, so
// the feature issue that fills in a section only ever touches its own file.
const GeneralSection = lazy(() =>
  import('./GeneralSection').then((module) => ({ default: module.GeneralSection })),
);
const StorageSection = lazy(() =>
  import('./StorageSection').then((module) => ({ default: module.StorageSection })),
);
const BackupsSection = lazy(() =>
  import('./BackupsSection').then((module) => ({ default: module.BackupsSection })),
);
const UpdatesSection = lazy(() =>
  import('./UpdatesSection').then((module) => ({ default: module.UpdatesSection })),
);
const DoctorSection = lazy(() =>
  import('./DoctorSection').then((module) => ({ default: module.DoctorSection })),
);

export const sectionDetails: Record<
  InstanceSettingsSection,
  { label: string; title: string; description: string; icon: typeof GearSixIcon }
> = {
  general: {
    label: 'General',
    title: 'General',
    description: 'Instance identity and defaults for this Coda deployment.',
    icon: GearSixIcon,
  },
  storage: {
    label: 'Storage',
    title: 'Storage',
    description: 'Choose and migrate the object storage backend for uploads.',
    icon: HardDrivesIcon,
  },
  backups: {
    label: 'Backups',
    title: 'Backups',
    description: 'Download, restore, and schedule signed instance backups.',
    icon: ArchiveIcon,
  },
  updates: {
    label: 'Updates',
    title: 'Updates',
    description: 'Check for new releases and run the guided upgrade ceremony.',
    icon: ArrowsClockwiseIcon,
  },
  doctor: {
    label: 'Doctor',
    title: 'Doctor',
    description: 'A sanitized diagnostic report for this instance.',
    icon: StethoscopeIcon,
  },
};

function SettingsLoadingFallback() {
  return <div className={styles.loading}>Loading…</div>;
}

function SettingsPanel({ section }: { section: InstanceSettingsSection }) {
  switch (section) {
    case 'general':
      return <GeneralSection />;
    case 'storage':
      return <StorageSection />;
    case 'backups':
      return <BackupsSection />;
    case 'updates':
      return <UpdatesSection />;
    case 'doctor':
      return <DoctorSection />;
  }
}

/**
 * Instance settings body. Navigation lives entirely in the dashboard rail —
 * there is no second sidebar. The active section is driven by the route; the
 * page header is a panel-frame header resolved from the rail declarations so
 * every deep link (`/admin/settings/*`) keeps working unchanged.
 */
export function InstanceSettingsScreen({
  section = 'general',
  isAdministrator,
}: {
  section?: InstanceSettingsSection;
  isAdministrator: boolean;
  // Kept for source compatibility with the dashboard mount; the shell always
  // embeds this screen and navigation is owned by the rail.
  embedded?: boolean;
}) {
  if (!isAdministrator) {
    return (
      <main className={styles.page}>
        <PanelHeader crumbs={['Administration', 'Instance Settings']} />
        <div className={styles.body}>
          <section className={styles.unavailable} role="alert">
            <PulseIcon size={18} aria-hidden="true" />
            <h1>Instance settings are unavailable.</h1>
            <p>This area is available only to the instance administrator.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PanelHeader crumbs={resolveRailCrumbs(instanceSettingsSectionPath(section))} />
      <div className={styles.body}>
        <div className={styles.column}>
          <Suspense fallback={<SettingsLoadingFallback />}>
            <SettingsPanel section={section} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
