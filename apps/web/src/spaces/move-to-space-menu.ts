import type { ResourceType } from '@coda/contracts';
import { ArrowsLeftRightIcon } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight';
import type { ContextMenuItem } from '../content-lists';

const resourceLabels: Record<ResourceType, string> = {
  breakdown: 'breakdown',
  screenplay: 'screenplay',
};

/** Shared registry-facing action so every registered resource type uses the same move vocabulary. */
export function moveToSpaceMenuItem(
  resourceType: ResourceType,
  onMove: () => void,
): ContextMenuItem {
  return {
    id: `move-${resourceType}-to-space`,
    label: `Move ${resourceLabels[resourceType]} to Space…`,
    icon: ArrowsLeftRightIcon,
    onSelect: onMove,
  };
}
