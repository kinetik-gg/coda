import { lazy, Suspense, useState } from 'react';
import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import { StethoscopeIcon } from '@phosphor-icons/react/dist/csr/Stethoscope';
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

const sectionOrder: InstanceSettingsSection[] = [
  'general',
  'storage',
  'backups',
  'updates',
  'doctor',
];

function SettingsLoadingFallback() {
  return <div className={styles.loading}>Loading…</div>;
}

function SettingsSidebar({
  activeSection,
  onSectionChange,
}: {
  activeSection: InstanceSettingsSection;
  onSectionChange: (section: InstanceSettingsSection) => void;
}) {
  return (
    <aside className={styles.sidebar} aria-label="Instance settings sections">
      <nav className={styles.sidebarNav}>
        {sectionOrder.map((section) => {
          const detail = sectionDetails[section];
          const Icon = detail.icon;
          return (
            <button
              key={section}
              type="button"
              className={styles.sidebarItem}
              aria-current={activeSection === section ? 'page' : undefined}
              onClick={() => onSectionChange(section)}
            >
              <Icon size={12} aria-hidden="true" />
              <span>{detail.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
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
 * The host sidebar (UnifiedHomeScreen) exposes a single "Settings" entry
 * point into this area, so — unlike AdminScreen/AccountScreen — this
 * component keeps its own section navigation visible even when embedded.
 */
export function InstanceSettingsScreen({
  section,
  isAdministrator,
  embedded = false,
  onSectionChange,
}: {
  section?: InstanceSettingsSection;
  isAdministrator: boolean;
  embedded?: boolean;
  onSectionChange?: (section: InstanceSettingsSection) => void;
}) {
  const [localSection, setLocalSection] = useState<InstanceSettingsSection>('general');
  const activeSection = section ?? localSection;
  const changeSection = (nextSection: InstanceSettingsSection) => {
    setLocalSection(nextSection);
    onSectionChange?.(nextSection);
  };

  if (!isAdministrator) {
    return (
      <main className={`${styles.settingsPage} ${embedded ? styles.embedded : ''}`}>
        <section className={styles.unavailable} role="alert">
          <PulseIcon size={18} aria-hidden="true" />
          <h1>Instance settings are unavailable.</h1>
          <p>This area is available only to the instance administrator.</p>
        </section>
      </main>
    );
  }

  const detail = sectionDetails[activeSection];
  return (
    <main className={`${styles.settingsPage} ${embedded ? styles.embedded : ''}`}>
      <div className={styles.settingsShell}>
        <SettingsSidebar activeSection={activeSection} onSectionChange={changeSection} />
        <div className={styles.content}>
          <header className={styles.contentHeader}>
            <h1>{detail.title}</h1>
            <p>{detail.description}</p>
          </header>
          <Suspense fallback={<SettingsLoadingFallback />}>
            <SettingsPanel section={activeSection} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
