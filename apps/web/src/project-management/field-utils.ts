import type { FieldType } from '@coda/contracts';

export const fieldTypes: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Decimal number' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'Single select' },
  { value: 'multi_enum', label: 'Multi select' },
  { value: 'file', label: 'File' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
];

export function normalizedFieldType(type: string): FieldType {
  return type.toLowerCase() as FieldType;
}

export function readableFieldType(type: string) {
  return fieldTypes.find((entry) => entry.value === normalizedFieldType(type))?.label ?? type;
}

export function fieldKeyFromName(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return /^[a-z]/.test(normalized)
    ? normalized
    : normalized
      ? `field_${normalized}`.slice(0, 64)
      : '';
}
