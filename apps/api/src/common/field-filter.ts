import { BadRequestException } from '@nestjs/common';
import type { FieldType } from '@prisma/client';
import type { ItemFilter } from '@coda/contracts';
import { uuidSchema } from '@coda/contracts';

/**
 * The typed field-filter engine shared by every field-filtered record list (breakdown items,
 * tracker records). It turns one contract filter against one field definition into where-input
 * fragments over the shared value-row column vocabulary; each surface wraps the fragments in its
 * own relation name and Prisma where-input type.
 */

/** Minimal field view both `FieldDefinition` and `TrackerField` rows satisfy. */
export interface FilterableField {
  id: string;
  key: string;
  type: FieldType;
  options: Array<{ id: string }>;
}

/**
 * A `{ values: { some: … } }` fragment keyed on the shared scalar columns. Cast at the call site
 * to the surface's concrete `Prisma.*WhereInput` — the shapes are structurally identical.
 */
export type ValueCondition = {
  values: { some: Record<string, unknown> } | { none: Record<string, unknown> };
};

type ComparisonOperator = Extract<
  ItemFilter['operator'],
  'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
>;

function invalidOperator(field: FilterableField, filter: ItemFilter): never {
  throw new BadRequestException(
    `Filter operator ${filter.operator} is not valid for ${field.type.toLowerCase()} fields`,
  );
}

function requireString(field: FilterableField, filter: ItemFilter): string {
  if (typeof filter.value !== 'string') {
    throw new BadRequestException(`Filter ${field.key} requires a string value`);
  }
  return filter.value;
}

function requireNumber(field: FilterableField, filter: ItemFilter): number {
  if (typeof filter.value !== 'number' || !Number.isFinite(filter.value)) {
    throw new BadRequestException(`Filter ${field.key} requires a finite number`);
  }
  if (field.type === 'INTEGER' && !Number.isInteger(filter.value)) {
    throw new BadRequestException(`Filter ${field.key} requires an integer`);
  }
  return filter.value;
}

function requireBoolean(field: FilterableField, filter: ItemFilter): boolean {
  if (typeof filter.value !== 'boolean') {
    throw new BadRequestException(`Filter ${field.key} requires a boolean`);
  }
  return filter.value;
}

function requireUuid(field: FilterableField, value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`Filter ${field.key} requires a UUID value`);
  }
  return parsed.data;
}

function requireComparison(field: FilterableField, filter: ItemFilter): ComparisonOperator {
  const comparisonOperators: ItemFilter['operator'][] = [
    'equals',
    'not_equals',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal',
  ];
  if (!comparisonOperators.includes(filter.operator)) return invalidOperator(field, filter);
  return filter.operator as ComparisonOperator;
}

function comparison<T>(operator: ComparisonOperator, value: T) {
  switch (operator) {
    case 'equals':
      return { equals: value };
    case 'not_equals':
      return { not: value };
    case 'greater_than':
      return { gt: value };
    case 'greater_or_equal':
      return { gte: value };
    case 'less_than':
      return { lt: value };
    case 'less_or_equal':
      return { lte: value };
  }
}

function condition(field: FilterableField, match: Record<string, unknown>): ValueCondition {
  return { values: { some: { fieldId: field.id, ...match } } };
}

function textFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  const value = requireString(field, filter);
  if (filter.operator === 'contains') {
    return [condition(field, { textValue: { contains: value, mode: 'insensitive' } })];
  }
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [condition(field, { textValue: comparison(operator, value) })];
}

function numberFilter(
  field: FilterableField,
  filter: ItemFilter,
  property: 'integerValue' | 'floatValue',
): ValueCondition[] {
  return [
    condition(field, {
      [property]: comparison(requireComparison(field, filter), requireNumber(field, filter)),
    }),
  ];
}

function booleanFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [condition(field, { booleanValue: comparison(operator, requireBoolean(field, filter)) })];
}

function dateFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  const value = requireString(field, filter);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`Filter ${field.key} requires a YYYY-MM-DD date`);
  }
  return [
    condition(field, {
      dateValue: comparison(requireComparison(field, filter), new Date(`${value}T00:00:00.000Z`)),
    }),
  ];
}

function enumFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  const optionId = requireUuid(field, filter.value);
  if (!field.options.some((option) => option.id === optionId)) {
    throw new BadRequestException(`Filter ${field.key} uses an option from another field`);
  }
  return [condition(field, { optionId: comparison(operator, optionId) })];
}

function requireOptionIds(field: FilterableField, filter: ItemFilter): string[] {
  if (!Array.isArray(filter.value) || !filter.value.length) {
    throw new BadRequestException(`Filter ${field.key} requires at least one option UUID`);
  }
  const optionIds = filter.value.map((value) => {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(`Filter ${field.key} requires option UUIDs`);
    }
    return parsed.data;
  });
  if (optionIds.some((id) => !field.options.some((option) => option.id === id))) {
    throw new BadRequestException(`Filter ${field.key} uses an option from another field`);
  }
  return optionIds;
}

function multiEnumFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  if (filter.operator !== 'has_any' && filter.operator !== 'has_all') {
    return invalidOperator(field, filter);
  }
  const optionIds = requireOptionIds(field, filter);
  if (filter.operator === 'has_any') {
    return [condition(field, { options: { some: { optionId: { in: optionIds } } } })];
  }
  return optionIds.map((optionId) => condition(field, { options: { some: { optionId } } }));
}

function storageFilter(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [
    condition(field, { storageObjectId: comparison(operator, requireUuid(field, filter.value)) }),
  ];
}

export function buildValueConditions(field: FilterableField, filter: ItemFilter): ValueCondition[] {
  if (filter.operator === 'is_empty') return [{ values: { none: { fieldId: field.id } } }];
  if (filter.operator === 'is_not_empty') return [{ values: { some: { fieldId: field.id } } }];

  switch (field.type) {
    case 'TEXT':
    case 'LONG_TEXT':
      return textFilter(field, filter);
    case 'INTEGER':
      return numberFilter(field, filter, 'integerValue');
    case 'FLOAT':
      return numberFilter(field, filter, 'floatValue');
    case 'BOOLEAN':
      return booleanFilter(field, filter);
    case 'DATE':
      return dateFilter(field, filter);
    case 'ENUM':
      return enumFilter(field, filter);
    case 'MULTI_ENUM':
      return multiEnumFilter(field, filter);
    case 'FILE':
    case 'IMAGE':
    case 'VIDEO':
      return storageFilter(field, filter);
  }
}
