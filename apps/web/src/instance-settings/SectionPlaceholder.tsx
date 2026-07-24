import type { ReactNode } from 'react';
import styles from './SectionPlaceholder.module.css';

/**
 * Shared empty-state shell for not-yet-implemented settings sections. Each
 * section file owns its own copy and icon; the feature issue that fills in a
 * section replaces this placeholder without touching any other section file.
 */
export function SectionPlaceholder({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.placeholder} role="status">
      {icon}
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
