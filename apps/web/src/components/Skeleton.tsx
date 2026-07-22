import type { CSSProperties, ReactNode } from 'react';
import styles from './Skeleton.module.css';

type SkeletonSize = number | string;

export function Skeleton({
  width = '100%',
  height = 10,
  radius,
  inline = false,
  className,
}: {
  width?: SkeletonSize;
  height?: SkeletonSize;
  radius?: SkeletonSize;
  inline?: boolean;
  className?: string;
}) {
  const style = {
    width,
    height,
    '--skeleton-radius':
      radius == null ? undefined : typeof radius === 'number' ? `${radius}px` : radius,
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className={`${styles.skeleton} ${inline ? styles.inline : ''} ${className ?? ''}`}
      style={style}
    />
  );
}

export function SkeletonGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.group} ${className ?? ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className={styles.screenReaderOnly}>{label}</span>
      {children}
    </div>
  );
}
