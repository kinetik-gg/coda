import type { ManagedEntityType } from './types';

export function getDeleteLevelState({
  selected,
  deepest,
  entityTypeCount,
  canManageEntities,
  hasItems,
  hasFields,
}: {
  selected: ManagedEntityType;
  deepest?: ManagedEntityType;
  entityTypeCount: number;
  canManageEntities: boolean;
  hasItems: boolean;
  hasFields: boolean;
}) {
  const mayDeleteLevel =
    canManageEntities &&
    selected.id === deepest?.id &&
    entityTypeCount > 1 &&
    !hasItems &&
    !hasFields;
  const deleteLevelHelp =
    entityTypeCount === 1
      ? 'A breakdown must keep at least one level.'
      : selected.id !== deepest?.id
        ? 'Remove deeper levels first.'
        : hasItems || hasFields
          ? 'Remove active and trashed items and custom fields first.'
          : undefined;
  return { mayDeleteLevel, deleteLevelHelp };
}
