import type { ReactNode } from 'react';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  /** Content hugging the leading edge; shrinks and ellipsizes first when space is tight. */
  left?: ReactNode;
  /** Content following `left`, grouped with `right` and pushed toward the trailing edge. */
  center?: ReactNode;
  /** Content pinned to the trailing edge, e.g. the canonical save-state chip. */
  right?: ReactNode;
  className?: string;
}

/**
 * Composable status-bar framework: left/center/right segment slots with shared, uppercase
 * micro-typography. Both the breakdown workspace and the screenplay editor mount one of these
 * (via the shell's toolbar slots) instead of maintaining their own bespoke status bar. A future
 * dashboard shell can mount the same component standalone with its own segments.
 */
export function StatusBar({ left, center, right, className }: StatusBarProps) {
  const hasTrailing = center !== undefined || right !== undefined;
  return (
    <div className={`${styles.bar} ${className ?? ''}`}>
      {left !== undefined && <div className={styles.left}>{left}</div>}
      {hasTrailing && (
        <div className={styles.trailing}>
          {center !== undefined && <div className={styles.center}>{center}</div>}
          {right !== undefined && <div className={styles.right}>{right}</div>}
        </div>
      )}
    </div>
  );
}

export interface StatusBarSegmentProps {
  /** Optional leading icon, e.g. a Phosphor icon element. */
  icon?: ReactNode;
  /** Spins the icon to indicate ongoing activity. */
  spin?: boolean;
  /** `accent` renders in the primary text color instead of the muted status-bar color. */
  tone?: 'muted' | 'accent';
  /** Native title attribute, surfaced as a tooltip. */
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The typed building block every status-bar entry composes from: a single piece of
 * uppercase micro-typography, with an optional icon. Both editors' identity, format, counts,
 * line, and spelling segments are instances of this component.
 */
export function StatusBarSegment({
  icon,
  spin = false,
  tone = 'muted',
  title,
  children,
  className,
}: StatusBarSegmentProps) {
  return (
    <span
      className={`${styles.segment} ${tone === 'accent' ? styles.segmentAccent : ''} ${className ?? ''}`}
      title={title}
    >
      {icon && (
        <span className={spin ? styles.spin : undefined} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
