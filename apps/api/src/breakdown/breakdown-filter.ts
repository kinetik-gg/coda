import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ItemFilter } from '@coda/contracts';
import { uuidSchema } from '@coda/contracts';

type FilterField = Prisma.FieldDefinitionGetPayload<{ include: { options: true } }>;
type ComparisonOperator = Extract<
  ItemFilter['operator'],
  'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal'
>;

function invalidOperator(field: FilterField, filter: ItemFilter): never {
  throw new BadRequestException(
    `Filter operator ${filter.operator} is not valid for ${field.type.toLowerCase()} fields`,
  );
}

function requireString(field: FilterField, filter: ItemFilter): string {
  if (typeof filter.value !== 'string') {
    throw new BadRequestException(`Filter ${field.key} requires a string value`);
  }
  return filter.value;
}

function requireNumber(field: FilterField, filter: ItemFilter): number {
  if (typeof filter.value !== 'number' || !Number.isFinite(filter.value)) {
    throw new BadRequestException(`Filter ${field.key} requires a finite number`);
  }
  if (field.type === 'INTEGER' && !Number.isInteger(filter.value)) {
    throw new BadRequestException(`Filter ${field.key} requires an integer`);
  }
  return filter.value;
}

function requireBoolean(field: FilterField, filter: ItemFilter): boolean {
  if (typeof filter.value !== 'boolean') {
    throw new BadRequestException(`Filter ${field.key} requires a boolean`);
  }
  return filter.value;
}

function requireUuid(field: FilterField, value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`Filter ${field.key} requires a UUID value`);
  }
  return parsed.data;
}

function requireComparison(field: FilterField, filter: ItemFilter): ComparisonOperator {
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

function textFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  const value = requireString(field, filter);
  if (filter.operator === 'contains') {
    return [
      {
        values: {
          some: { fieldId: field.id, textValue: { contains: value, mode: 'insensitive' } },
        },
      },
    ];
  }
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [{ values: { some: { fieldId: field.id, textValue: comparison(operator, value) } } }];
}

function numberFilter(
  field: FilterField,
  filter: ItemFilter,
  property: 'integerValue' | 'floatValue',
): Prisma.BreakdownItemWhereInput[] {
  return [
    {
      values: {
        some: {
          fieldId: field.id,
          [property]: comparison(requireComparison(field, filter), requireNumber(field, filter)),
        },
      },
    },
  ];
}

function booleanFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [
    {
      values: {
        some: {
          fieldId: field.id,
          booleanValue: comparison(operator, requireBoolean(field, filter)),
        },
      },
    },
  ];
}

function dateFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  const value = requireString(field, filter);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`Filter ${field.key} requires a YYYY-MM-DD date`);
  }
  return [
    {
      values: {
        some: {
          fieldId: field.id,
          dateValue: comparison(
            requireComparison(field, filter),
            new Date(`${value}T00:00:00.000Z`),
          ),
        },
      },
    },
  ];
}

function enumFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  const optionId = requireUuid(field, filter.value);
  if (!field.options.some((option) => option.id === optionId)) {
    throw new BadRequestException(`Filter ${field.key} uses an option from another field`);
  }
  return [{ values: { some: { fieldId: field.id, optionId: comparison(operator, optionId) } } }];
}

function requireOptionIds(field: FilterField, filter: ItemFilter): string[] {
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

function multiEnumFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  if (filter.operator !== 'has_any' && filter.operator !== 'has_all') {
    return invalidOperator(field, filter);
  }
  const optionIds = requireOptionIds(field, filter);
  if (filter.operator === 'has_any') {
    return [
      {
        values: {
          some: { fieldId: field.id, options: { some: { optionId: { in: optionIds } } } },
        },
      },
    ];
  }
  return optionIds.map((optionId) => ({
    values: { some: { fieldId: field.id, options: { some: { optionId } } } },
  }));
}

function storageFilter(field: FilterField, filter: ItemFilter): Prisma.BreakdownItemWhereInput[] {
  const operator = requireComparison(field, filter);
  if (operator !== 'equals' && operator !== 'not_equals') return invalidOperator(field, filter);
  return [
    {
      values: {
        some: {
          fieldId: field.id,
          storageObjectId: comparison(operator, requireUuid(field, filter.value)),
        },
      },
    },
  ];
}

export function buildTypedFilter(
  field: FilterField,
  filter: ItemFilter,
): Prisma.BreakdownItemWhereInput[] {
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
