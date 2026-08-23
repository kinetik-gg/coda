import type { Prisma } from '@prisma/client';
import type { ItemFilter } from '@coda/contracts';
import { buildValueConditions } from '../common/field-filter';

type FilterField = Prisma.FieldDefinitionGetPayload<{ include: { options: true } }>;

/**
 * Breakdown-side wrapper over the shared typed-filter engine: the operator×type rules live in
 * `common/field-filter`, this cast adapts the generic `{ values: { some: … } }` fragments to the
 * breakdown item where-input.
 */
export function buildTypedFilter(
  field: FilterField,
  filter: ItemFilter,
): Prisma.BreakdownItemWhereInput[] {
  return buildValueConditions(field, filter) as Prisma.BreakdownItemWhereInput[];
}
