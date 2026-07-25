import type { ComponentType } from 'react';

export interface IconProps {
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  'aria-hidden'?: boolean;
}

export type PhosphorIcon = ComponentType<IconProps>;
