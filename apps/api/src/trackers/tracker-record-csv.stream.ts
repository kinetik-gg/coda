import type { Prisma } from '@prisma/client';
import { csvCell, csvFieldValue } from '../exports/exports.service';

/**
 * Demand-driven CSV streaming for one tracker's record grid, the twin of the breakdown level
 * export in `../exports`: a header row of `id`, `title`, and one column per active field in
 * field order, then one row per live record fetched in {@link TRACKER_CSV_PAGE_SIZE} cursor
 * pages only as the consumer pulls chunks. Cell rendering goes through the shared
 * `csvCell`/`csvFieldValue` pair, so injection neutralization and per-type serialization are
 * byte-identical to the breakdown export. Media cells render the storage object's original
 * filename; unlike breakdown values, tracker value rows carry only a bare `storageObjectId`,
 * so each page resolves its names with one extra batched query.
 */

export const TRACKER_CSV_PAGE_SIZE = 500;

const csvInclude = {
  values: {
    orderBy: [{ fieldId: 'asc' }] as Prisma.TrackerFieldValueOrderByWithRelationInput[],
    include: { option: true, options: { include: { option: true } } },
  },
} satisfies Prisma.TrackerRecordInclude;

export type TrackerCsvRecord = Prisma.TrackerRecordGetPayload<{ include: typeof csvInclude }>;

/** Minimal structural view of a Prisma client able to page tracker records and name media. */
export interface TrackerCsvClient {
  trackerRecord: {
    findMany(args: {
      where: Prisma.TrackerRecordWhereInput;
      include: typeof csvInclude;
      orderBy: Prisma.TrackerRecordOrderByWithRelationInput[];
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<TrackerCsvRecord[]>;
  };
  storageObject: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; originalFilename: true };
    }): Promise<Array<{ id: string; originalFilename: string }>>;
  };
}

export interface TrackerRecordCsvExport {
  /** Slugified attachment filename derived from the tracker name. */
  filename: string;
  content: AsyncGenerator<string>;
  release: () => void;
}

/** Attachment filename for a tracker's record export, slugified like the breakdown twin. */
export function trackerCsvFilename(trackerName: string): string {
  return `${trackerName.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase() || 'records'}.csv`;
}

/** Adapts one stored value row to the shared serializer's shape, naming its media reference. */
function csvView(value: TrackerCsvRecord['values'][number], filenames: Map<string, string>) {
  return {
    textValue: value.textValue,
    integerValue: value.integerValue,
    floatValue: value.floatValue,
    booleanValue: value.booleanValue,
    dateValue: value.dateValue,
    option: value.option,
    options: value.options,
    storageObject: value.storageObjectId
      ? { originalFilename: filenames.get(value.storageObjectId) ?? '' }
      : null,
  };
}

/**
 * Streams header plus rows for the already-authorized query. Ordering and filtering are decided
 * by the caller so the exported set is exactly the record list's semantics.
 */
export async function* trackerRecordCsvChunks(
  client: TrackerCsvClient,
  fields: ReadonlyArray<{ id: string; name: string }>,
  query: {
    where: Prisma.TrackerRecordWhereInput;
    orderBy: Prisma.TrackerRecordOrderByWithRelationInput[];
  },
): AsyncGenerator<string> {
  yield `${['id', 'title', ...fields.map((field) => field.name)].map(csvCell).join(',')}\r\n`;
  let cursor: string | undefined;
  do {
    const records = await client.trackerRecord.findMany({
      where: query.where,
      include: csvInclude,
      orderBy: query.orderBy,
      take: TRACKER_CSV_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const storageIds = [
      ...new Set(
        records.flatMap((record) =>
          record.values.flatMap((value) => (value.storageObjectId ? [value.storageObjectId] : [])),
        ),
      ),
    ];
    const filenames = new Map(
      storageIds.length
        ? (
            await client.storageObject.findMany({
              where: { id: { in: storageIds } },
              select: { id: true, originalFilename: true },
            })
          ).map((object) => [object.id, object.originalFilename])
        : [],
    );
    for (const record of records) {
      const values = new Map(
        record.values.map((value) => [value.fieldId, csvView(value, filenames)]),
      );
      yield `${[
        record.id,
        record.title,
        ...fields.map((field) => {
          const value = values.get(field.id);
          return value === undefined ? '' : csvFieldValue(value);
        }),
      ]
        .map(csvCell)
        .join(',')}\r\n`;
    }
    cursor = records.length === TRACKER_CSV_PAGE_SIZE ? records.at(-1)?.id : undefined;
  } while (cursor);
}
