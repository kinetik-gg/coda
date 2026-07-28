import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { FilmStripIcon } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { useState } from 'react';
import type { SpaceSummary } from '../api';
import styles from './DashboardShell.module.css';

export function SpaceSwitcher({
  activeSpace,
  spaces,
  onSelectSpace,
  onNavigate,
}: {
  activeSpace?: SpaceSummary;
  spaces: readonly SpaceSummary[];
  onSelectSpace: (spaceId: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!activeSpace) return null;

  return (
    <div className={styles.spaceSwitcher}>
      <div className={styles.spaceSwitcherControls}>
        <button
          type="button"
          data-rail-item
          className={styles.spaceSwitcherButton}
          aria-expanded={expanded}
          aria-haspopup="listbox"
          onClick={() => setExpanded((current) => !current)}
        >
          <FilmStripIcon size={16} aria-hidden />
          <span className={styles.railItemLabel}>{activeSpace.name}</span>
          <CaretUpDownIcon size={14} aria-hidden />
        </button>
        <button
          type="button"
          data-rail-item
          className={styles.spaceSettingsButton}
          aria-label={`Manage ${activeSpace.name} Space`}
          onClick={() => onNavigate(`/spaces/${activeSpace.id}/manage`)}
        >
          <GearSixIcon size={16} aria-hidden />
        </button>
      </div>
      {expanded && (
        <div className={styles.spaceOptions} role="listbox" aria-label="Spaces">
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              role="option"
              data-rail-item
              className={styles.spaceOption}
              aria-selected={space.id === activeSpace.id}
              onClick={() => {
                onSelectSpace(space.id);
                setExpanded(false);
              }}
            >
              <FilmStripIcon size={16} aria-hidden />
              <span className={styles.railItemLabel}>{space.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
