import { ConflictException } from '@nestjs/common';
import { assertOptionsAllowed, reconcileRankedOptions } from '../common/field-options';
import type { BreakdownTransaction, FieldOptionUpdateInput } from './breakdown.types';

export { assertOptionsAllowed };

export async function assertFieldKeyAvailable(
  tx: BreakdownTransaction,
  entityTypeId: string,
  key: string,
  excludedFieldId?: string,
): Promise<void> {
  const existing = await tx.fieldDefinition.findFirst({
    where: {
      entityTypeId,
      key,
      ...(excludedFieldId ? { id: { not: excludedFieldId } } : {}),
    },
    select: { id: true, deletedAt: true },
  });
  if (!existing) return;
  throw new ConflictException(
    existing.deletedAt
      ? 'That key is reserved by a field in trash; restore or purge it first'
      : 'A field with that key already exists on this entity type',
  );
}

export async function reconcileFieldOptions(
  tx: BreakdownTransaction,
  fieldId: string,
  existing: Array<{ id: string }>,
  options: FieldOptionUpdateInput[],
): Promise<void> {
  await reconcileRankedOptions(tx.fieldOption, fieldId, existing, options);
}
