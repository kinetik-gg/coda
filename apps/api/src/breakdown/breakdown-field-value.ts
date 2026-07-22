import { BadRequestException } from '@nestjs/common';
import { StorageKind } from '@prisma/client';
import type { FieldType } from '@prisma/client';
import type { FieldType as ContractFieldType, FieldValueInput } from '@coda/contracts';

export const fieldTypeMap: Record<ContractFieldType, FieldType> = {
  text: 'TEXT',
  long_text: 'LONG_TEXT',
  enum: 'ENUM',
  multi_enum: 'MULTI_ENUM',
  integer: 'INTEGER',
  float: 'FLOAT',
  boolean: 'BOOLEAN',
  date: 'DATE',
  file: 'FILE',
  image: 'IMAGE',
  video: 'VIDEO',
};

export function storageReferenceForValue(
  value: FieldValueInput,
): { kind: StorageKind; storageObjectId: string } | undefined {
  switch (value.type) {
    case 'file':
      return { kind: StorageKind.FILE, storageObjectId: value.storageObjectId };
    case 'image':
      return { kind: StorageKind.IMAGE, storageObjectId: value.storageObjectId };
    case 'video':
      return { kind: StorageKind.VIDEO, storageObjectId: value.storageObjectId };
    case 'text':
    case 'long_text':
    case 'integer':
    case 'float':
    case 'boolean':
    case 'date':
    case 'enum':
    case 'multi_enum':
      return undefined;
  }
}

export function valueData(value: FieldValueInput, validOptionIds: string[]) {
  switch (value.type) {
    case 'text':
    case 'long_text':
      return { scalar: { textValue: value.value } };
    case 'integer':
      return { scalar: { integerValue: value.value } };
    case 'float':
      return { scalar: { floatValue: value.value } };
    case 'boolean':
      return { scalar: { booleanValue: value.value } };
    case 'date':
      return { scalar: { dateValue: new Date(`${String(value.value)}T00:00:00.000Z`) } };
    case 'enum':
      if (!validOptionIds.includes(value.optionId)) {
        throw new BadRequestException('Invalid field option');
      }
      return { scalar: { optionId: value.optionId } };
    case 'multi_enum': {
      if (value.optionIds.some((id) => !validOptionIds.includes(id))) {
        throw new BadRequestException('Invalid field option');
      }
      return { scalar: {}, optionIds: value.optionIds };
    }
    case 'file':
    case 'image':
    case 'video':
      return { scalar: { storageObjectId: value.storageObjectId } };
  }
}
