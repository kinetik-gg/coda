import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FieldType } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';
import type { BreakdownTransaction, FieldOptionUpdateInput } from './breakdown.types';

export function assertOptionsAllowed(
  type: FieldType,
  options: Array<{ label: string }> | undefined,
): void {
  if (options?.length && type !== 'ENUM' && type !== 'MULTI_ENUM') {
    throw new BadRequestException('Options are only supported by enum and multi-enum fields');
  }
  if (!options) return;
  const labels = options.map((option) => option.label.toLocaleLowerCase());
  if (new Set(labels).size !== labels.length) {
    throw new BadRequestException('Option labels must be unique');
  }
}

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
  const existingIds = new Set(existing.map((option) => option.id));
  const requestedIds = options.flatMap((option) => (option.id ? [option.id] : []));
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new BadRequestException('Each field option may only appear once');
  }
  if (requestedIds.some((id) => !existingIds.has(id))) {
    throw new BadRequestException('A field option does not belong to this field');
  }

  const ranks = evenlySpacedRanks(options.length);
  await tx.fieldOption.updateMany({
    where: { fieldId, id: { notIn: requestedIds }, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  for (const [index, option] of options.entries()) {
    const data = {
      label: option.label,
      color: option.color,
      position: ranks[index]!,
      archivedAt: null,
    };
    if (option.id) {
      await tx.fieldOption.update({ where: { id: option.id }, data });
      continue;
    }
    await tx.fieldOption.create({ data: { fieldId, ...data } });
  }
}
