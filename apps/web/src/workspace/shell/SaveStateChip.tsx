import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap';
import { SAVE_STATE_DESCRIPTORS, type SaveState } from './save-state';
import styles from './StatusBar.module.css';

type SaveStateDescriptorTone = 'muted' | 'success' | 'danger';

const toneClass: Record<SaveStateDescriptorTone, string> = {
  muted: styles.chipMuted!,
  success: styles.chipSuccess!,
  danger: styles.chipDanger!,
};

/**
 * The single canonical save-state chip. Both editors render exactly this component, mapping
 * their own persistence layer onto the shared `SaveState` vocabulary rather than rendering a
 * bespoke status label.
 */
export function SaveStateChip({ state }: { state: SaveState }) {
  const descriptor = SAVE_STATE_DESCRIPTORS[state];
  return (
    <span
      className={`${styles.chip} ${toneClass[descriptor.tone]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {descriptor.spinning ? (
        <SpinnerGapIcon size={11} className={styles.spin} aria-hidden="true" />
      ) : descriptor.tone === 'success' ? (
        <CheckIcon size={11} aria-hidden="true" />
      ) : null}
      {descriptor.label}
    </span>
  );
}
