import { describe, expect, it, vi } from 'vitest';
import type { ScreenplayConversionElement } from '@coda/contracts';
import {
  buildScreenplayConversionReport,
  resolveScreenplayAdapterLimits,
} from './screenplay-adapter-limits';

const config = vi.hoisted(() => ({
  SCREENPLAY_ADAPTER_TIMEOUT_MS: 12_000,
  SCREENPLAY_ADAPTER_MAX_INPUT_BYTES: 4_096,
  SCREENPLAY_ADAPTER_MAX_OUTPUT_CHARACTERS: 2_048,
  SCREENPLAY_ADAPTER_MAX_ELEMENTS: 16,
  SCREENPLAY_ADAPTER_MAX_WARNINGS: 4,
}));

vi.mock('../../config/env', () => ({ env: () => config }));

function element(
  id: string,
  status: ScreenplayConversionElement['status'],
): ScreenplayConversionElement {
  return {
    id,
    status,
    source: { kind: 'line', location: { unit: 'line', start: 0, end: 1 } },
    target: null,
    summary: `Element ${id}`,
    warnings: [],
  };
}

describe('resolveScreenplayAdapterLimits', () => {
  it('reads every ceiling from operator configuration', () => {
    expect(resolveScreenplayAdapterLimits()).toEqual({
      timeoutMs: 12_000,
      maxInputBytes: 4_096,
      maxOutputCharacters: 2_048,
      maxElements: 16,
      maxWarnings: 4,
    });
  });
});

describe('buildScreenplayConversionReport', () => {
  it('derives the summary from the elements so an adapter cannot miscount', () => {
    const report = buildScreenplayConversionReport({
      sourceFormat: 'docx',
      adapter: { id: 'coda.spec', version: '2' },
      output: {
        convertedFountain: '!Line',
        elements: [
          element('a', 'preserved'),
          element('b', 'converted'),
          element('c', 'converted'),
          element('d', 'unsupported'),
        ],
        warnings: [{ code: 'style', message: 'Style dropped' }],
      },
      generatedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
    expect(report.summary).toEqual({
      total: 4,
      preserved: 1,
      converted: 2,
      uncertain: 0,
      unsupported: 1,
    });
    expect(report).toMatchObject({
      schemaVersion: 1,
      sourceFormat: 'docx',
      adapter: { id: 'coda.spec', version: '2' },
      generatedAt: '2026-07-30T10:00:00.000Z',
    });
  });

  it('rejects adapter output the durable report contract would refuse', () => {
    expect(() =>
      buildScreenplayConversionReport({
        sourceFormat: 'docx',
        adapter: { id: '', version: '2' },
        output: { convertedFountain: '', elements: [], warnings: [] },
        generatedAt: new Date('2026-07-30T10:00:00.000Z'),
      }),
    ).toThrow();
  });
});
