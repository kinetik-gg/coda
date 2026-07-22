import { describe, expect, it } from 'vitest';
import type { FieldDefinition, FieldValue } from './types';
import {
  apiToFieldValue,
  displayFieldValue,
  readableText,
  reorderGap,
  valueToApi,
  type ApiFieldValue,
} from './item-panel-utils';

function field(type: string): FieldDefinition {
  return {
    id: 'field',
    name: 'Field',
    key: 'field',
    type,
    required: false,
    version: 1,
    options: [
      { id: 'red', label: 'Red' },
      { id: 'blue', label: 'Blue' },
    ],
  };
}

function stored(overrides: Partial<FieldValue> = {}): FieldValue {
  return {
    fieldId: 'field',
    textValue: null,
    integerValue: null,
    floatValue: null,
    booleanValue: null,
    dateValue: null,
    options: [],
    ...overrides,
  };
}

describe('item panel helpers', () => {
  it('preserves ordinary text values without interpreting their format', () => {
    expect(readableText('ordinary source text')).toBe('ordinary source text');
    expect(readableText(null)).toBe('');
    expect(readableText(42)).toBe('42');
    expect(readableText(false)).toBe('false');
    expect(readableText({ nested: true })).toBe('');
  });

  it('describes the target gap after removing the moved row', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect(reorderGap(rows, 'b', 3)).toEqual({ beforeId: null, afterId: 'd' });
    expect(reorderGap(rows, 'd', 1)).toEqual({ beforeId: 'b', afterId: 'a' });
    expect(reorderGap(rows, 'a', -10)).toEqual({ beforeId: 'b', afterId: null });
  });

  it('chooses a readable display for every stored field shape', () => {
    expect(displayFieldValue(undefined)).toBe('');
    expect(displayFieldValue(stored({ option: { id: 'red', label: 'Red' } }))).toBe('Red');
    expect(
      displayFieldValue(
        stored({
          options: [
            { option: { id: 'red', label: 'Red' } },
            { option: { id: 'blue', label: 'Blue' } },
          ],
        }),
      ),
    ).toBe('Red, Blue');
    expect(displayFieldValue(stored({ booleanValue: false }))).toBe('FALSE');
    expect(displayFieldValue(stored({ booleanValue: true }))).toBe('TRUE');
    expect(displayFieldValue(stored({ integerValue: 0 }))).toBe('0');
    expect(displayFieldValue(stored({ floatValue: 1.5 }))).toBe('1.5');
    expect(displayFieldValue(stored({ dateValue: '2026-07-22T00:00:00Z' }))).toBe('2026-07-22');
    expect(displayFieldValue(stored({ textValue: 'notes' }))).toBe('notes');
  });

  it.each([
    ['text', stored({ textValue: 'copy' }), { type: 'text', value: 'copy' }],
    ['long_text', stored({ textValue: 'notes' }), { type: 'long_text', value: 'notes' }],
    ['integer', stored({ integerValue: 2 }), { type: 'integer', value: 2 }],
    ['float', stored({ floatValue: 2.5 }), { type: 'float', value: 2.5 }],
    ['boolean', stored({ booleanValue: false }), { type: 'boolean', value: false }],
    ['date', stored({ dateValue: '2026-07-22T00:00:00Z' }), { type: 'date', value: '2026-07-22' }],
    ['enum', stored({ option: { id: 'red', label: 'Red' } }), { type: 'enum', optionId: 'red' }],
    [
      'multi_enum',
      stored({ options: [{ option: { id: 'blue', label: 'Blue' } }] }),
      { type: 'multi_enum', optionIds: ['blue'] },
    ],
    ['file', stored({ storageObjectId: 'object' }), { type: 'file', storageObjectId: 'object' }],
  ] as Array<[string, FieldValue, ApiFieldValue]>)(
    'converts %s storage to API input',
    (type, value, expected) => {
      expect(valueToApi(field(type), value)).toEqual(expected);
    },
  );

  it('returns null for absent and incompatible stored values', () => {
    expect(valueToApi(field('text'), undefined)).toBeNull();
    expect(valueToApi(field('integer'), stored())).toBeNull();
    expect(valueToApi(field('file'), stored())).toBeNull();
    expect(valueToApi(field('future'), stored())).toBeNull();
  });

  it.each([
    [{ type: 'text', value: 'copy' }, { textValue: 'copy' }],
    [{ type: 'long_text', value: 'notes' }, { textValue: 'notes' }],
    [{ type: 'integer', value: 2 }, { integerValue: 2 }],
    [{ type: 'float', value: 2.5 }, { floatValue: 2.5 }],
    [{ type: 'boolean', value: false }, { booleanValue: false }],
    [{ type: 'date', value: '2026-07-22' }, { dateValue: '2026-07-22' }],
    [{ type: 'enum', optionId: 'red' }, { option: { id: 'red', label: 'Red' } }],
    [
      { type: 'multi_enum', optionIds: ['blue', 'missing'] },
      { options: [{ option: { id: 'blue', label: 'Blue' } }] },
    ],
    [{ type: 'image', storageObjectId: 'object' }, { storageObjectId: 'object' }],
  ] as Array<[ApiFieldValue, Partial<FieldValue>]>)(
    'merges API input %j into a field value',
    (input, expected) => {
      expect(apiToFieldValue(field(input.type), input, stored({ textValue: 'old' }))).toMatchObject(
        expected,
      );
    },
  );

  it('clears values and ignores unknown enum options defensively', () => {
    expect(apiToFieldValue(field('text'), null)).toBeUndefined();
    expect(
      apiToFieldValue(field('enum'), { type: 'enum', optionId: 'missing' })?.option,
    ).toBeNull();
  });
});
