import { BadRequestException } from '@nestjs/common';
import type { FieldType } from '@prisma/client';
import { evenlySpacedRanks } from './rank';

/**
 * Option-collection mechanics shared by the breakdown and tracker field-definition surfaces:
 * the enum-only rule and case-insensitive label uniqueness asserted on every write path, plus
 * the ranked full-replace reconciliation used when a definition body restates its option list.
 */

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

/**
 * Structural stand-in for a Prisma model client (`prisma.fieldOption` / `prisma.trackerFieldOption`)
 * so one reconciliation body serves both surfaces.
 */
export interface RankedOptionDelegate {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

export interface RankedOptionInput {
  label: string;
  color?: string | null;
  id?: string;
}

/**
 * Restates a field's option list: every active option absent from the request is archived,
 * known ids are updated in request order onto fresh evenly spaced ranks (unarchiving in the
 * process), and unknown ids are created. Requested ids must belong to this field and appear once.
 */
export async function reconcileRankedOptions(
  delegate: RankedOptionDelegate,
  fieldId: string,
  existing: Array<{ id: string }>,
  options: RankedOptionInput[],
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
  await delegate.updateMany({
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
      await delegate.update({ where: { id: option.id }, data });
      continue;
    }
    await delegate.create({ data: { fieldId, ...data } });
  }
}
