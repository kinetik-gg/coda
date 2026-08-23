import type { Prisma } from '@prisma/client';
import type { TrackerRecordFilter } from '@coda/contracts';
import { buildValueConditions, type FilterableField } from '../common/field-filter';

/**
 * Tracker-side wrapper over the shared typed-filter engine: adapts the generic
 * `{ values: { some: … } }` fragments to tracker record where-inputs. The caller resolves each
 * filter's field row (with its active options) before invoking this.
 */
export function buildTrackerRecordFilter(
  field: FilterableField,
  filter: TrackerRecordFilter,
): Prisma.TrackerRecordWhereInput[] {
  return buildValueConditions(field, filter) as Prisma.TrackerRecordWhereInput[];
}
