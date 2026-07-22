import type { FieldDefinition, FieldValue } from './types';

export type ApiFieldValue =
  | { type: 'text'; value: string }
  | { type: 'long_text'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'float'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'enum'; optionId: string }
  | { type: 'multi_enum'; optionIds: string[] }
  | { type: 'file'; storageObjectId: string }
  | { type: 'image'; storageObjectId: string }
  | { type: 'video'; storageObjectId: string };

export function readableText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}

export function displayFieldValue(value: FieldValue | undefined): string {
  if (!value) return '';
  if (value.option) return value.option.label;
  if (value.options?.length) return value.options.map((entry) => entry.option.label).join(', ');
  if (value.booleanValue !== null) return value.booleanValue ? 'TRUE' : 'FALSE';
  if (value.integerValue !== null) return String(value.integerValue);
  if (value.floatValue !== null) return String(value.floatValue);
  if (value.dateValue) return value.dateValue.slice(0, 10);
  return readableText(value.textValue);
}

export function valueToApi(
  field: FieldDefinition,
  value: FieldValue | undefined,
): ApiFieldValue | null {
  const type = field.type.toLowerCase();
  if (!value) return null;
  if (type === 'text' || type === 'long_text') {
    return { type, value: readableText(value.textValue) };
  }
  if (type === 'integer' && value.integerValue !== null)
    return { type: 'integer', value: value.integerValue };
  if (type === 'float' && value.floatValue !== null)
    return { type: 'float', value: value.floatValue };
  if (type === 'boolean' && value.booleanValue !== null)
    return { type: 'boolean', value: value.booleanValue };
  if (type === 'date' && value.dateValue)
    return { type: 'date', value: value.dateValue.slice(0, 10) };
  if (type === 'enum' && value.option?.id) return { type: 'enum', optionId: value.option.id };
  if (type === 'multi_enum')
    return { type: 'multi_enum', optionIds: value.options.map((entry) => entry.option.id) };
  if (['file', 'image', 'video'].includes(type) && value.storageObjectId)
    return { type: type as 'file' | 'image' | 'video', storageObjectId: value.storageObjectId };
  return null;
}

export function apiToFieldValue(
  field: FieldDefinition,
  input: ApiFieldValue | null,
  previous?: FieldValue,
): FieldValue | undefined {
  if (!input) return undefined;
  const base: FieldValue = {
    fieldId: field.id,
    textValue: null,
    integerValue: null,
    floatValue: null,
    booleanValue: null,
    dateValue: null,
    options: [],
    ...previous,
    option: null,
  };
  if (input.type === 'text' || input.type === 'long_text')
    return { ...base, textValue: input.value };
  if (input.type === 'integer') return { ...base, integerValue: input.value };
  if (input.type === 'float') return { ...base, floatValue: input.value };
  if (input.type === 'boolean') return { ...base, booleanValue: input.value };
  if (input.type === 'date') return { ...base, dateValue: input.value };
  if (input.type === 'enum')
    return {
      ...base,
      option: field.options.find((option) => option.id === input.optionId) ?? null,
    };
  if (input.type === 'multi_enum')
    return {
      ...base,
      options: input.optionIds.flatMap((id) => {
        const option = field.options.find((candidate) => candidate.id === id);
        return option ? [{ option }] : [];
      }),
    };
  return { ...base, storageObjectId: input.storageObjectId };
}

export function reorderGap<T extends { id: string }>(
  items: T[],
  movedId: string,
  targetIndex: number,
) {
  const remaining = items.filter((item) => item.id !== movedId);
  const bounded = Math.max(0, Math.min(targetIndex, remaining.length));
  return {
    beforeId: remaining[bounded]?.id ?? null,
    afterId: remaining[bounded - 1]?.id ?? null,
  };
}
