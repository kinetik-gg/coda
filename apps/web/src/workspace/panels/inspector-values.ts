import type { FieldDefinition, FieldValue } from './types';
import type { ApiFieldValue } from './item-panel-utils';

export type InspectorEditorKind =
  'text' | 'multiline' | 'number' | 'date' | 'boolean' | 'enum' | 'multi';
export type InspectorEditorValue = string | string[];

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
  const type = field.type.toLowerCase();
  if (type === 'text' || type === 'long_text') {
    if (typeof value?.textValue === 'string') return value.textValue;
    return value?.textValue == null ? '' : JSON.stringify(value.textValue);
  }
  if (type === 'integer') return value?.integerValue == null ? '' : String(value.integerValue);
  if (type === 'float') return value?.floatValue == null ? '' : String(value.floatValue);
  if (type === 'boolean') return value?.booleanValue == null ? '' : String(value.booleanValue);
  if (type === 'date') return value?.dateValue?.slice(0, 10) ?? '';
  if (type === 'enum') return value?.option?.id ?? '';
  if (type === 'multi_enum') return value?.options.map((entry) => entry.option.id) ?? [];
  return '';
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
