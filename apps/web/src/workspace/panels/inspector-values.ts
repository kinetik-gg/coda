import type { FieldDefinition, FieldValue } from './types';
import type { ApiFieldValue } from './item-panel-utils';

export type InspectorEditorKind =
  'text' | 'multiline' | 'number' | 'date' | 'boolean' | 'enum' | 'multi';
export type InspectorEditorValue = string | string[];

type ValueReader = (value?: FieldValue) => InspectorEditorValue;

const readTextValue: ValueReader = (value) =>
  typeof value?.textValue === 'string'
    ? value.textValue
    : value?.textValue == null
      ? ''
      : JSON.stringify(value.textValue);

const editorValueReaders: Record<string, ValueReader> = {
  text: readTextValue,
  long_text: readTextValue,
  integer: (value) => (value?.integerValue == null ? '' : String(value.integerValue)),
  float: (value) => (value?.floatValue == null ? '' : String(value.floatValue)),
  boolean: (value) => (value?.booleanValue == null ? '' : String(value.booleanValue)),
  date: (value) => value?.dateValue?.slice(0, 10) ?? '',
  enum: (value) => value?.option?.id ?? '',
  multi_enum: (value) => value?.options.map((entry) => entry.option.id) ?? [],
};

export function editorKindForField(type: string): InspectorEditorKind {
  if (type === 'long_text') return 'multiline';
  if (type === 'integer' || type === 'float') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'date') return 'date';
  if (type === 'enum') return 'enum';
  if (type === 'multi_enum') return 'multi';
  return 'text';
}

export function customEditorValue(
  field: FieldDefinition,
  value?: FieldValue,
): InspectorEditorValue {
  return editorValueReaders[field.type.toLowerCase()]?.(value) ?? '';
}

function textInput(
  field: FieldDefinition,
  text: string,
  type: 'text' | 'long_text',
): ApiFieldValue | null {
  if (!text && !field.required) return null;
  if (!text) throw new Error(`${field.name} is required.`);
  return { type, value: text };
}

function integerInput(text: string): ApiFieldValue | null {
  if (!text) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error('Enter a whole number.');
  }
  return { type: 'integer', value };
}

function floatInput(text: string): ApiFieldValue | null {
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error('Enter a valid number.');
  return { type: 'float', value };
}

export function inputForCustom(
  field: FieldDefinition,
  draft: InspectorEditorValue,
): ApiFieldValue | null {
  const type = field.type.toLowerCase();
  const text = Array.isArray(draft) ? '' : draft;
  if (type === 'text' || type === 'long_text') return textInput(field, text, type);
  if (type === 'integer') return integerInput(text);
  if (type === 'float') return floatInput(text);
  if (type === 'boolean') return !text ? null : { type: 'boolean', value: text === 'true' };
  if (type === 'date') return !text ? null : { type: 'date', value: text };
  if (type === 'enum') return !text ? null : { type: 'enum', optionId: text };
  if (type === 'multi_enum') {
    return draft.length ? { type: 'multi_enum', optionIds: draft as string[] } : null;
  }
  return null;
}
