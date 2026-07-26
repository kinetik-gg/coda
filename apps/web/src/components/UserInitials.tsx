import styles from './UserInitials.module.css';

/** At most two initials, with a stable account fallback for blank display names. */
export function initialsForName(displayName?: string): string {
  const parts = (displayName ?? '').trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return 'A';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .join('');
}

/**
 * A quiet identity image for places that already expose the person's name or an accessible label.
 * The square is decorative to assistive technology so initials never repeat the adjacent name.
 */
export function UserInitials({ name }: { name?: string }) {
  return (
    <span className={styles.initials} data-user-initials aria-hidden="true">
      {initialsForName(name)}
    </span>
  );
}
