import { describe, expect, it } from 'vitest';
import type { FieldDefinition, FieldValue } from './types';
import { customEditorValue, editorKindForField, inputForCustom } from './inspector-values';

function field(type: string, required = false): FieldDefinition {
  return { id: type, name: 'Custom field', key: type, type, required, version: 1, options: [] };
}

function value(overrides: Partial<FieldValue>): FieldValue {
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

describe('inspector field values', () => {
  it.each([
    ['long_text', 'multiline'],
    ['integer', 'number'],
    ['float', 'number'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['enum', 'enum'],
    ['multi_enum', 'multi'],
    ['text', 'text'],
  ] as const)('selects the %s editor', (type, expected) => {
    expect(editorKindForField(type)).toBe(expected);
  });

  it('converts stored typed values into editor drafts', () => {
    expect(customEditorValue(field('text'), value({ textValue: 'notes' }))).toBe('notes');
    expect(customEditorValue(field('long_text'), value({ textValue: { rich: true } }))).toBe(
      '{"rich":true}',
    );
    expect(customEditorValue(field('integer'), value({ integerValue: 12 }))).toBe('12');
    expect(customEditorValue(field('float'), value({ floatValue: 1.5 }))).toBe('1.5');
    expect(customEditorValue(field('boolean'), value({ booleanValue: false }))).toBe('false');
    expect(customEditorValue(field('date'), value({ dateValue: '2026-07-22T10:00:00Z' }))).toBe(
      '2026-07-22',
    );
    expect(customEditorValue(field('enum'), value({ option: { id: 'blue', label: 'Blue' } }))).toBe(
      'blue',
    );
    expect(
      customEditorValue(
        field('multi_enum'),
        value({ options: [{ option: { id: 'one', label: 'One' } }] }),
      ),
    ).toEqual(['one']);
    expect(customEditorValue(field('future'), undefined)).toBe('');
  });

  it('converts valid drafts to API payloads and clears optional values', () => {
    expect(inputForCustom(field('text'), 'hello')).toEqual({ type: 'text', value: 'hello' });
    expect(inputForCustom(field('text'), '')).toBeNull();
    expect(inputForCustom(field('integer'), '42')).toEqual({ type: 'integer', value: 42 });
    expect(inputForCustom(field('float'), '1.25')).toEqual({ type: 'float', value: 1.25 });
    expect(inputForCustom(field('boolean'), 'false')).toEqual({ type: 'boolean', value: false });
    expect(inputForCustom(field('date'), '2026-07-22')).toEqual({
      type: 'date',
      value: '2026-07-22',
    });
    expect(inputForCustom(field('enum'), 'blue')).toEqual({ type: 'enum', optionId: 'blue' });
    expect(inputForCustom(field('multi_enum'), ['one', 'two'])).toEqual({
      type: 'multi_enum',
      optionIds: ['one', 'two'],
    });
    expect(inputForCustom(field('future'), 'anything')).toBeNull();
  });

  it('rejects required, out-of-range, fractional integer, and invalid float values', () => {
    expect(() => inputForCustom(field('text', true), '')).toThrow('Custom field is required.');
    expect(() => inputForCustom(field('integer'), '1.2')).toThrow('Enter a whole number.');
    expect(() => inputForCustom(field('integer'), '2147483648')).toThrow('Enter a whole number.');
    expect(() => inputForCustom(field('float'), 'not-a-number')).toThrow('Enter a valid number.');
    expect(inputForCustom(field('integer'), '')).toBeNull();
    expect(inputForCustom(field('float'), '')).toBeNull();
    expect(inputForCustom(field('boolean'), '')).toBeNull();
    expect(inputForCustom(field('multi_enum'), [])).toBeNull();
  });
});
