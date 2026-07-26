import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import styles from './ShareButton.module.css';

/**
 * The in-object entry point to an object's share modal.
 *
 * A menu item alone is not an affordance a user can find, so both editing surfaces carry this
 * button in their masthead's trailing cluster — the screenplay editor beside the document identity
 * chip, the breakdown workspace beside the breakdown chip. Same placement, same icon, same word
 * (#176). The `File ▸ Share…` and breakdown-chip menu items remain, for the keyboard and for
 * muscle memory.
 *
 * Callers render it only when the viewer may manage the object, so it is never a dead control. The
 * accessible name stays exactly "Share" on both surfaces: the word is the vocabulary this release
 * settled on, and only one object is ever open at a time.
 */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.shareButton} onClick={onClick} aria-label="Share">
      <UsersThreeIcon size={13} aria-hidden="true" />
      <span>Share</span>
    </button>
  );
}
