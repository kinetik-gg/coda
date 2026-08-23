import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ItemFilter } from '@coda/contracts';
import { buildValueConditions, type FilterableField } from './field-filter';

function field(overrides: Partial<FilterableField> = {}): FilterableField {
  return {
    id: 'field-1',
    key: 'status',
    type: 'TEXT',
    options: [
      { id: '20000000-0000-4000-8000-000000000001' },
      { id: '20000000-0000-4000-8000-000000000002' },
    ],
    ...overrides,
  };
}

const OPT_1 = '20000000-0000-4000-8000-000000000001';
const OPT_2 = '20000000-0000-4000-8000-000000000002';

function filter(overrides: Partial<ItemFilter>): ItemFilter {
  return { fieldId: 'field-1', operator: 'equals', value: 'x', ...overrides } as ItemFilter;
}

describe('buildValueConditions', () => {
  it('tests emptiness against the whole value row', () => {
    expect(
      buildValueConditions(field(), filter({ operator: 'is_empty', value: undefined })),
    ).toEqual([{ values: { none: { fieldId: 'field-1' } } }]);
    expect(
      buildValueConditions(field(), filter({ operator: 'is_not_empty', value: undefined })),
    ).toEqual([{ values: { some: { fieldId: 'field-1' } } }]);
  });

  it('matches text case-insensitively on contains and exactly otherwise', () => {
    expect(buildValueConditions(field(), filter({ operator: 'contains', value: 'Ope' }))).toEqual([
      {
        values: {
          some: { fieldId: 'field-1', textValue: { contains: 'Ope', mode: 'insensitive' } },
        },
      },
    ]);
    expect(buildValueConditions(field(), filter({ operator: 'not_equals', value: 'a' }))).toEqual([
      { values: { some: { fieldId: 'field-1', textValue: { not: 'a' } } } },
    ]);
    expect(() =>
      buildValueConditions(field(), filter({ operator: 'greater_than', value: 3 })),
    ).toThrow(BadRequestException);
    expect(() => buildValueConditions(field(), filter({ operator: 'contains', value: 7 }))).toThrow(
      'Filter status requires a string value',
    );
  });

  it('compares numbers per column and keeps integers integral', () => {
    const int = field({ type: 'INTEGER' });
    expect(buildValueConditions(int, filter({ operator: 'greater_or_equal', value: 4 }))).toEqual([
      { values: { some: { fieldId: 'field-1', integerValue: { gte: 4 } } } },
    ]);
    expect(() => buildValueConditions(int, filter({ value: 1.5 }))).toThrow(
      'Filter status requires an integer',
    );
    const float = field({ type: 'FLOAT' });
    expect(buildValueConditions(float, filter({ operator: 'less_than', value: 0.5 }))).toEqual([
      { values: { some: { fieldId: 'field-1', floatValue: { lt: 0.5 } } } },
    ]);
    expect(() => buildValueConditions(float, filter({ value: 'nine' }))).toThrow(
      'requires a finite number',
    );
  });

  it('restricts booleans to equality operators', () => {
    const bool = field({ type: 'BOOLEAN' });
    expect(buildValueConditions(bool, filter({ value: true }))).toEqual([
      { values: { some: { fieldId: 'field-1', booleanValue: { equals: true } } } },
    ]);
    expect(() =>
      buildValueConditions(bool, filter({ operator: 'has_any', value: [true] })),
    ).toThrow(BadRequestException);
    expect(() => buildValueConditions(bool, filter({ value: 'yes' }))).toThrow(
      'requires a boolean',
    );
  });

  it('parses dates as UTC midnight and refuses other shapes', () => {
    const date = field({ type: 'DATE' });
    expect(
      buildValueConditions(date, filter({ operator: 'less_or_equal', value: '2026-08-24' })),
    ).toEqual([
      {
        values: {
          some: { fieldId: 'field-1', dateValue: { lte: new Date('2026-08-24T00:00:00.000Z') } },
        },
      },
    ]);
    expect(() => buildValueConditions(date, filter({ value: '24-08-2026' }))).toThrow(
      'requires a YYYY-MM-DD date',
    );
  });

  it('validates single-select filters against the field options', () => {
    const enumeration = field({ type: 'ENUM' });
    expect(buildValueConditions(enumeration, filter({ value: OPT_2 }))).toEqual([
      { values: { some: { fieldId: 'field-1', optionId: { equals: OPT_2 } } } },
    ]);
    expect(() =>
      buildValueConditions(enumeration, filter({ value: '99999999-9999-4999-8999-999999999999' })),
    ).toThrow('uses an option from another field');
    expect(() => buildValueConditions(enumeration, filter({ value: 'nope' }))).toThrow(
      'requires a UUID value',
    );
  });

  it('expands has_any into one membership probe and has_all into one per option', () => {
    const multi = field({ type: 'MULTI_ENUM' });
    expect(
      buildValueConditions(multi, filter({ operator: 'has_any', value: [OPT_1, OPT_2] })),
    ).toEqual([
      {
        values: {
          some: { fieldId: 'field-1', options: { some: { optionId: { in: [OPT_1, OPT_2] } } } },
        },
      },
    ]);
    const all = buildValueConditions(multi, filter({ operator: 'has_all', value: [OPT_1, OPT_2] }));
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({
      values: { some: { fieldId: 'field-1', options: { some: { optionId: OPT_2 } } } },
    });
    expect(() =>
      buildValueConditions(multi, filter({ operator: 'equals', value: [OPT_1] })),
    ).toThrow(BadRequestException);
    expect(() => buildValueConditions(multi, filter({ operator: 'has_all', value: [] }))).toThrow(
      'requires at least one option UUID',
    );
    expect(() =>
      buildValueConditions(
        multi,
        filter({ operator: 'has_any', value: [OPT_1, '99999999-9999-4999-8999-999999999999'] }),
      ),
    ).toThrow('uses an option from another field');
  });

  it('filters media cells by storage object id', () => {
    const file = field({ type: 'FILE' });
    expect(
      buildValueConditions(file, filter({ value: '30000000-0000-4000-8000-000000000003' })),
    ).toEqual([
      {
        values: {
          some: {
            fieldId: 'field-1',
            storageObjectId: { equals: '30000000-0000-4000-8000-000000000003' },
          },
        },
      },
    ]);
    expect(() => buildValueConditions(file, filter({ operator: 'contains', value: 'x' }))).toThrow(
      BadRequestException,
    );
  });
});
