import type { WorkspacePanel } from '@coda/contracts';
import type { BreakdownItem, EntityType, FieldDefinition, PanelContentProps } from './types';

export type EntityPanel = Extract<WorkspacePanel, { type: 'entity_table' }>;

export type EntityTableColumn = {
  key: string;
  label: string;
  field?: FieldDefinition;
};

export function entityTableColumns(
  type: EntityType,
  projectTypes: EntityType[],
  fields: FieldDefinition[],
): EntityTableColumn[] {
  const deepestLevel = Math.max(...projectTypes.map((entry) => entry.level));
  return [
    { key: 'code', label: 'CODE' },
    { key: 'title', label: 'TITLE' },
    ...(type.level < deepestLevel ? [{ key: 'children', label: 'COUNT' }] : []),
    ...fields.map((field) => ({ key: `field:${field.id}`, label: field.name, field })),
  ];
}

export function columnIsVisible(panel: EntityPanel, column: EntityTableColumn): boolean {
  return column.field
    ? panel.config.visibleCustomFieldIds.includes(column.field.id)
    : !panel.config.hiddenColumns.includes(column.key);
}

export function contextParentId(
  type: EntityType,
  projectTypes: EntityType[],
  activeEntity: PanelContentProps['activeEntity'],
): string | undefined {
  if (type.level === 1 || !activeEntity) return undefined;
  const parentType = projectTypes.find((entry) => entry.level === type.level - 1);
  if (!parentType) return undefined;
  const ancestry = [activeEntity.item, activeEntity.item.parent, activeEntity.item.parent?.parent];
  return ancestry.find((entry) => entry?.entityTypeId === parentType.id)?.id;
}

export function hydratedItem(update: Partial<BreakdownItem>, base?: BreakdownItem): BreakdownItem {
  return {
    ...(base ?? {
      id: update.id!,
      entityTypeId: update.entityTypeId!,
      title: update.title!,
      displayCode: null,
      description: null,
      version: update.version ?? 1,
      values: [],
      sourceReferences: [],
    }),
    ...update,
    values: update.values ?? base?.values ?? [],
    sourceReferences: update.sourceReferences ?? base?.sourceReferences ?? [],
  };
}
