import { describe, expect, it, vi } from 'vitest';
import type { TrackerCsvClient, TrackerCsvRecord } from './tracker-record-csv.stream';
import {
  TRACKER_CSV_PAGE_SIZE,
  trackerCsvFilename,
  trackerRecordCsvChunks,
} from './tracker-record-csv.stream';

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let output = '';
  for await (const chunk of chunks) output += chunk;
  return output;
}

function client(findMany: ReturnType<typeof vi.fn>, storageNames: Record<string, string> = {}) {
  return {
    trackerRecord: { findMany },
    storageObject: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Object.entries(storageNames)
          .filter(([id]) => where.id.in.includes(id))
          .map(([id, originalFilename]) => ({ id, originalFilename })),
      ),
    },
  } as unknown as TrackerCsvClient;
}

function csvValue(overrides: Record<string, unknown>) {
  return {
    id: 'value-id',
    fieldId: 'field',
    textValue: null,
    integerValue: null,
    floatValue: null,
    booleanValue: null,
    dateValue: null,
    optionId: null,
    storageObjectId: null,
    option: null,
    options: [],
    ...overrides,
  } as unknown as TrackerCsvRecord['values'][number];
}

function record(id: string, title: string, values: TrackerCsvRecord['values'] = []) {
  return { id, title, values } as TrackerCsvRecord;
}

const FIELDS = [
  { id: 'text', name: 'Notes' },
  { id: 'enum', name: 'Status' },
  { id: 'multi', name: 'Tags' },
  { id: 'integer', name: 'Count' },
  { id: 'float', name: 'Ratio' },
  { id: 'boolean', name: 'Locked' },
  { id: 'date', name: 'Due' },
  { id: 'file', name: 'Asset' },
  { id: 'empty', name: 'Blank' },
];

const TYPED_VALUES = [
  csvValue({ fieldId: 'text', textValue: "=cmd|' /C calc'!A0" }),
  csvValue({ fieldId: 'enum', option: { label: 'Approved' } }),
  csvValue({
    fieldId: 'multi',
    options: [{ option: { label: 'Day 1' } }, { option: { label: 'Night' } }],
  }),
  csvValue({ fieldId: 'integer', integerValue: -12 }),
  csvValue({ fieldId: 'float', floatValue: 1.5 }),
  csvValue({ fieldId: 'boolean', booleanValue: false }),
  csvValue({ fieldId: 'date', dateValue: new Date('2026-08-24T00:00:00.000Z') }),
];

describe('trackerRecordCsvChunks', () => {
  it('serializes every field type in field order and neutralizes formula cells', async () => {
    const typed = [
      ...TYPED_VALUES,
      csvValue({ fieldId: 'file', storageObjectId: 'so-1' }),
      csvValue({ fieldId: 'video', storageObjectId: 'so-missing' }),
    ];
    const findMany = vi.fn().mockResolvedValue([record('r-1', 'Scene 4', typed)]);
    const output = await collect(
      trackerRecordCsvChunks(client(findMany, { 'so-1': 'plate.exr' }), FIELDS, {
        where: {},
        orderBy: [],
      }),
    );

    const lines = output.split('\r\n');
    expect(lines[0]).toBe('id,title,Notes,Status,Tags,Count,Ratio,Locked,Due,Asset,Blank');
    expect(lines[1]).toBe(
      "r-1,Scene 4,'=cmd|' /C calc'!A0,Approved,Day 1; Night,-12,1.5,false,2026-08-24,plate.exr,",
    );
    expect(output.endsWith('\r\n')).toBe(true);
  });

  it.each([
    '=SUM(1,2)',
    '+cmd',
    '-1+2',
    '@mention',
    '  =HYPERLINK("x")',
    '\ufeff=formula',
    '\u200b+flag',
  ])('never lets a text cell start with a spreadsheet trigger: %s', async (note) => {
    const findMany = vi
      .fn()
      .mockResolvedValue([record('r-1', 'T', [csvValue({ fieldId: 'text', textValue: note })])]);
    const output = await collect(
      trackerRecordCsvChunks(client(findMany), FIELDS.slice(0, 1), {
        where: {},
        orderBy: [],
      }),
    );
    const notesCell = String(output.split('\r\n')[1]).slice('r-1,T,'.length);
    expect(notesCell.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('quotes titles containing commas, quotes, and newline injection', async () => {
    const findMany = vi.fn().mockResolvedValue([record('r-1', 'Line, "two"\nthree')]);
    const output = await collect(
      trackerRecordCsvChunks(client(findMany), [], { where: {}, orderBy: [] }),
    );
    expect(output).toContain('"Line, ""two""\nthree"');
  });

  it('emits a bare header row for an empty tracker without querying records twice', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const output = await collect(
      trackerRecordCsvChunks(client(findMany), FIELDS.slice(0, 2), {
        where: {},
        orderBy: [],
      }),
    );
    expect(output).toBe('id,title,Notes,Status\r\n');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: TRACKER_CSV_PAGE_SIZE }));
  });

  it('skips the media-name lookup for pages without media values', async () => {
    const findMany = vi.fn().mockResolvedValue([record('r-1', 'T')]);
    const storageFindMany = vi.fn();
    const double = {
      trackerRecord: { findMany },
      storageObject: { findMany: vi.fn() },
    } as unknown as TrackerCsvClient;
    await collect(trackerRecordCsvChunks(double, FIELDS, { where: {}, orderBy: [] }));
    expect(storageFindMany).not.toHaveBeenCalled();
  });

  it('continues across cursor pages only as the consumer drains the stream', async () => {
    const firstPage = Array.from({ length: TRACKER_CSV_PAGE_SIZE }, (_, index) =>
      record(`r-${index}`, `Row ${index}`),
    );
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([record('r-final', 'Last')]);
    const chunks = trackerRecordCsvChunks(client(findMany), [], {
      where: { trackerId: 't-1' },
      orderBy: [{ position: 'asc' }],
    });

    const iterator = chunks[Symbol.asyncIterator]();
    expect(findMany).not.toHaveBeenCalled();

    expect((await iterator.next()).value).toBe('id,title\r\n');
    expect(findMany).not.toHaveBeenCalled();

    await iterator.next();
    expect(findMany).toHaveBeenCalledTimes(1);

    for (let index = 0; index < TRACKER_CSV_PAGE_SIZE - 1; index += 1) {
      await iterator.next();
    }
    expect(findMany).toHaveBeenCalledTimes(1);

    const last = await iterator.next();
    expect(last.value).toBe('r-final,Last\r\n');
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { id: `r-${TRACKER_CSV_PAGE_SIZE - 1}` },
        skip: 1,
        where: { trackerId: 't-1' },
        orderBy: [{ position: 'asc' }],
      }),
    );
    expect(findMany).toHaveBeenCalledTimes(2);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});

describe('trackerCsvFilename', () => {
  it('slugifies the tracker name and falls back to records', () => {
    expect(trackerCsvFilename('Continuity / Unit Log')).toBe('continuity-unit-log.csv');
    expect(trackerCsvFilename('')).toBe('records.csv');
  });
});
