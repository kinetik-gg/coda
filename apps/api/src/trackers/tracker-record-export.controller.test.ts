import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRecordExportsController } from './tracker-record-export.controller';

const TRACKER = '10000000-0000-4000-8000-000000000001';

function response() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  stream.on('error', () => undefined);
  return Object.assign(stream, {
    setHeader: vi.fn(),
    body: () => chunks.join(''),
  });
}

function exportResult(csvChunks: string[], filename = 'tracker.csv') {
  let released = false;
  const content = (async function* () {
    await Promise.resolve();
    for (const chunk of csvChunks) yield chunk;
  })();
  return { filename, content, release: () => (released = true), released: () => released };
}

describe('TrackerRecordExportsController', () => {
  it('streams the CSV as an attachment and releases the admission slot', async () => {
    const result = exportResult(['id,title\r\n', 'r-1,Row\r\n']);
    const records = { exportCsv: vi.fn().mockResolvedValue(result) };
    const controller = new TrackerRecordExportsController(records as never);
    const res = response();

    await controller.csv({ user: { id: 'user-1' } } as never, res as never, TRACKER, {
      search: ' row ',
      filters: '[]',
    });

    expect(records.exportCsv).toHaveBeenCalledWith('user-1', TRACKER, {
      sort: 'manual',
      direction: 'asc',
      filters: [],
      search: 'row',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="tracker.csv"',
    );
    expect(res.body()).toBe('id,title\r\nr-1,Row\r\n');
    expect(result.released()).toBe(true);
  });

  it('releases the admission slot when the client connection fails mid-stream', async () => {
    const result = exportResult(['id,title\r\n'], 'tracker.csv');
    result.content = (async function* () {
      await Promise.resolve();
      yield 'id,title\r\n';
      throw new Error('client gone');
    })();
    const records = { exportCsv: vi.fn().mockResolvedValue(result) };
    const controller = new TrackerRecordExportsController(records as never);

    await expect(
      controller.csv({ user: { id: 'user-1' } } as never, response() as never, TRACKER, {}),
    ).rejects.toThrow('client gone');
    expect(result.released()).toBe(true);
  });
});
