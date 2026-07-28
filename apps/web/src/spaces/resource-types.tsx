import type { ResourceType } from '@coda/contracts';
import { FileIcon } from '@phosphor-icons/react/dist/csr/File';
import { TreeStructureIcon } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { lazy, type ComponentType } from 'react';

export type ResourceTypeIcon = ComponentType<{
  size?: number;
  weight?: 'regular' | 'fill';
  'aria-hidden'?: boolean;
}>;

type ResourceListComponent = ComponentType<never>;

const ScreenplaysList = lazy(async () => {
  const screenplays = await import('../ScreenplaysScreen');
  return { default: screenplays.ScreenplaysScreen };
});

const BreakdownsList = lazy(async () => {
  const breakdowns = await import('../ProjectsScreen');
  return { default: breakdowns.ProjectsScreen };
});

export interface WebResourceType {
  id: ResourceType;
  label: string;
  icon: ResourceTypeIcon;
  listRoute: string;
  listComponent: ResourceListComponent;
}

/**
 * The web projection of the contracts resource-type registry. Navigation derives its resource
 * rows from this list; a resource only appears in the product once it has a real list surface.
 */
export const webResourceTypes = [
  {
    id: 'screenplay',
    label: 'Screenplays',
    icon: FileIcon,
    listRoute: '/screenplays',
    listComponent: ScreenplaysList,
  },
  {
    id: 'breakdown',
    label: 'Breakdowns',
    icon: TreeStructureIcon,
    listRoute: '/breakdowns',
    listComponent: BreakdownsList,
  },
] as const satisfies readonly WebResourceType[];
