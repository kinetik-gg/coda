export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'is_empty'
  | 'is_not_empty'
  | 'has_any'
  | 'has_all';

export interface FilterDraft {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: string;
}

interface FilterField {
  id: string;
  type: string;
}

export interface TypedItemFilter {
  fieldId: string;
  operator: FilterOperator;
  value?: string | number | boolean | string[];
}

const valueFreeOperators = new Set<FilterOperator>(['is_empty', 'is_not_empty']);

export function operatorsForField(type: string): FilterOperator[] {
  switch (type.toLowerCase()) {
    case 'text':
    case 'long_text':
      return ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'];
    case 'integer':
    case 'float':
    case 'date':
      return [
        'equals',
        'not_equals',
        'greater_than',
        'greater_or_equal',
        'less_than',
        'less_or_equal',
        'is_empty',
        'is_not_empty',
      ];
    case 'multi_enum':
      return ['has_any', 'has_all', 'is_empty', 'is_not_empty'];
    default:
      return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  }
}

export function toApiFilter(draft: FilterDraft, fields: FilterField[]): TypedItemFilter | null {
  const field = fields.find((candidate) => candidate.id === draft.fieldId);
  if (!field) return null;
  if (valueFreeOperators.has(draft.operator)) {
    return { fieldId: field.id, operator: draft.operator };
  }
  if (!draft.value) return null;

  const type = field.type.toLowerCase();
  let value: TypedItemFilter['value'] = draft.value;
  if (type === 'integer' || type === 'float') {
    const parsed = Number(draft.value);
    if (!Number.isFinite(parsed) || (type === 'integer' && !Number.isInteger(parsed))) return null;
    value = parsed;
  } else if (type === 'boolean') {
    if (draft.value !== 'true' && draft.value !== 'false') return null;
    value = draft.value === 'true';
  } else if (type === 'multi_enum') {
    value = [draft.value];
  }
  return { fieldId: field.id, operator: draft.operator, value };
}

export function buildItemListPath(
  projectId: string,
  entityTypeId: string,
  options: {
    search: string;
    sort: string;
    direction: 'asc' | 'desc';
    filters: TypedItemFilter[];
  },
): string {
  const query = new URLSearchParams({
    entityTypeId,
    limit: '100',
    sort: options.sort,
    direction: options.direction,
  });
  if (options.search.trim()) query.set('search', options.search.trim());
  if (options.filters.length) query.set('filters', JSON.stringify(options.filters));
  return `/api/v1/projects/${projectId}/items?${query.toString()}`;
}

export function reorderBounds(ids: string[], activeId: string, overId: string) {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const ordered = [...ids];
  ordered.splice(from, 1);
  ordered.splice(to, 0, activeId);
  const index = ordered.indexOf(activeId);
  return {
    beforeId: ordered[index + 1] ?? null,
    afterId: ordered[index - 1] ?? null,
  };
}
