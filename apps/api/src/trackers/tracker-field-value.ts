import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FieldValueInput } from '@coda/contracts';
import { fieldTypeMap, storageReferenceForValue, valueData } from '../common/field-values';

/**
 * Typed writes into `TrackerFieldValue` rows: one value per (record, field), scalar columns
 * selected by the field's type vocabulary, single-select through a validated `optionId`, and
 * multi-enum through join rows that are fully replaced on every set. File/image/video values
 * reference an existing READY `StorageObject` owned by this tracker — the upload flow itself
 * ships separately.
 */

export type TrackerTransaction = Prisma.TransactionClient;

interface ValueWriteTarget {
  recordId: string;
  fieldId: string;
  required: boolean;
  type: string;
  activeOptionIds: string[];
}

async function assertStorageObject(
  tx: TrackerTransaction,
  trackerId: string,
  value: FieldValueInput,
): Promise<void> {
  const reference = storageReferenceForValue(value);
  if (!reference) return;
  const storageObject = await tx.storageObject.findFirst({
    where: {
      id: reference.storageObjectId,
      trackerId,
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

function assertTypeMatch(target: ValueWriteTarget, value: FieldValueInput): void {
  if (fieldTypeMap[value.type] !== target.type) {
    throw new BadRequestException('Value type does not match field definition');
  }
}

/**
 * Applies one value write inside the caller's transaction. A `null` value clears the cell
 * (refused on required fields); anything else is validated against the field's type and options,
 * then upserted with every unrelated column reset so stale scalars never survive a re-type.
 */
export async function writeTrackerFieldValue(
  tx: TrackerTransaction,
  trackerId: string,
  target: ValueWriteTarget,
  value: FieldValueInput | null,
): Promise<void> {
  if (value === null) {
    if (target.required) throw new BadRequestException('This field is required');
    await tx.trackerFieldValue.deleteMany({
      where: { recordId: target.recordId, fieldId: target.fieldId },
    });
    return;
  }

  assertTypeMatch(target, value);
  await assertStorageObject(tx, trackerId, value);
  const data = valueData(value, target.activeOptionIds);
  await tx.trackerFieldValue.upsert({
    where: { recordId_fieldId: { recordId: target.recordId, fieldId: target.fieldId } },
    create: {
      recordId: target.recordId,
      fieldId: target.fieldId,
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
