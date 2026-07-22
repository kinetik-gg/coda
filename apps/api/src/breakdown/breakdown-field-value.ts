import { BadRequestException, ConflictException } from '@nestjs/common';
import { StorageKind } from '@prisma/client';
import type { FieldType } from '@prisma/client';
import type { FieldType as ContractFieldType, FieldValueInput } from '@coda/contracts';
import { touchProject } from './breakdown-service-helpers';
import type { BreakdownTransaction } from './breakdown.types';

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

interface SetFieldValueInput {
  itemId: string;
  fieldId: string;
  value: FieldValueInput | null;
  itemVersion: number;
}

async function assertStorageValue(
  tx: BreakdownTransaction,
  projectId: string,
  value: FieldValueInput,
): Promise<void> {
  const reference = storageReferenceForValue(value);
  if (!reference) return;
  const storageObject = await tx.storageObject.findFirst({
    where: {
      id: reference.storageObjectId,
      projectId,
      kind: reference.kind,
      status: 'READY',
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!storageObject) {
    throw new BadRequestException('Storage object is unavailable or does not match the field type');
  }
}

export async function setFieldValue(
  tx: BreakdownTransaction,
  projectId: string,
  userId: string,
  input: SetFieldValueInput,
) {
  const [item, field] = await Promise.all([
    tx.breakdownItem.findFirst({
      where: { id: input.itemId, projectId, version: input.itemVersion, deletedAt: null },
    }),
    tx.fieldDefinition.findFirst({
      where: { id: input.fieldId, projectId, deletedAt: null },
      include: { options: { where: { archivedAt: null } } },
    }),
  ]);
  if (!item) throw new ConflictException('Item has changed; refresh and retry');
  if (!field || field.entityTypeId !== item.entityTypeId) {
    throw new BadRequestException('Field does not belong to this item type');
  }

  if (input.value === null) {
    if (field.required) throw new BadRequestException('This field is required');
    await tx.fieldValue.deleteMany({ where: { itemId: input.itemId, fieldId: input.fieldId } });
  } else {
    if (fieldTypeMap[input.value.type] !== field.type) {
      throw new BadRequestException('Value type does not match field definition');
    }
    await assertStorageValue(tx, projectId, input.value);
    const data = valueData(
      input.value,
      field.options.map((option) => option.id),
    );
    await tx.fieldValue.upsert({
      where: { itemId_fieldId: { itemId: input.itemId, fieldId: input.fieldId } },
      create: {
        itemId: input.itemId,
        fieldId: input.fieldId,
        ...data.scalar,
        ...(data.optionIds
          ? { options: { create: data.optionIds.map((optionId) => ({ optionId })) } }
          : {}),
      },
      update: {
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        optionId: null,
        storageObjectId: null,
        options: {
          deleteMany: {},
          ...(data.optionIds ? { create: data.optionIds.map((optionId) => ({ optionId })) } : {}),
        },
        ...data.scalar,
      },
    });
  }
  const updated = await tx.breakdownItem.update({
    where: { id: input.itemId },
    data: { version: { increment: 1 } },
  });
  await touchProject(tx, projectId, userId, {
    action: 'UPDATED',
    resourceType: 'field_value',
    resourceId: input.fieldId,
  });
  return updated;
}
