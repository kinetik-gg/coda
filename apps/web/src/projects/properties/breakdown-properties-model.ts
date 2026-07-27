import type { ManagedProject } from '../../project-management/types';

/** One level of the breakdown's hierarchy, shallowest first. */
export interface BreakdownLevelEntry {
  id: string;
  level: number;
  name: string;
  /** Absent when the management payload did not carry a count for the level. */
  itemCount?: number;
  fieldCount?: number;
}

export interface BreakdownPropertiesModel {
  levels: BreakdownLevelEntry[];
  /** Totals from the management payload's `_count`; absent when it was not included. */
  itemCount?: number;
  sourceDocumentCount?: number;
  roleCount: number;
}

/**
 * Derives the properties's read-only view of one breakdown from its management payload.
 *
 * The breakdown analogue of `screenplay-properties-model.ts`, and deliberately cheaper: a
 * screenplay's page count needs the layout engine, whereas a breakdown's shape is already
 * enumerated by the API. Nothing here computes — it only orders and names — so the pane costs one
 * read and no work on the dashboard thread.
 */
export function buildBreakdownPropertiesModel(
  management: ManagedProject,
): BreakdownPropertiesModel {
  const levels = [...management.entityTypes]
    .sort((left, right) => left.level - right.level)
    .map((entityType) => ({
      id: entityType.id,
      level: entityType.level,
      name: entityType.pluralName,
      itemCount: entityType._count?.items,
      fieldCount: entityType.fields?.length,
    }));
  return {
    levels,
    itemCount: management._count?.items,
    sourceDocumentCount: management._count?.sourceDocuments,
    roleCount: management.roles.length,
  };
}
