import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
  completeScreenplayImportArtifactSchema,
  reserveScreenplayImportArtifactSchema,
  screenplayConversionReportSchema,
} from './screenplay-conversion';

function report() {
  return {
    schemaVersion: SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
    sourceFormat: 'docx',
    adapter: { id: 'coda-docx', version: '1.0.0' },
    generatedAt: '2026-07-30T00:00:00.000Z',
    summary: {
      total: 2,
      preserved: 1,
      converted: 0,
      uncertain: 0,
      unsupported: 1,
    },
    warnings: [{ code: 'document-warning', message: 'Review the omitted drawing.' }],
    elements: [
      {
        id: 'paragraph-1',
        status: 'preserved',
        source: {
          kind: 'paragraph',
          location: { unit: 'paragraph', start: 0, end: 1 },
        },
        target: {
          kind: 'action',
          location: { unit: 'line', start: 0, end: 1 },
        },
        summary: 'Action paragraph preserved.',
        warnings: [],
      },
      {
        id: 'drawing-1',
        status: 'unsupported',
        source: {
          kind: 'drawing',
          location: { unit: 'paragraph', start: 1, end: 2 },
        },
        target: null,
        summary: 'Embedded drawing cannot be represented in Fountain.',
        warnings: [{ code: 'drawing-omitted', message: 'The drawing was omitted.' }],
      },
    ],
  } as const;
}

describe('screenplay conversion contracts', () => {
  it('validates a versioned report with source and target locations', () => {
    expect(screenplayConversionReportSchema.parse(report())).toEqual(report());
  });

  it('rejects reports whose summary does not match their elements', () => {
    const invalid = report();
    expect(() =>
      screenplayConversionReportSchema.parse({
        ...invalid,
        summary: { ...invalid.summary, preserved: 0 },
      }),
    ).toThrow('Summary preserved does not match conversion elements');
  });

  it('rejects inverted ranges and future report versions', () => {
    const invalid = report();
    expect(() =>
      screenplayConversionReportSchema.parse({
        ...invalid,
        elements: [
          {
            ...invalid.elements[0],
            source: {
              kind: 'paragraph',
              location: { unit: 'paragraph', start: 2, end: 1 },
            },
          },
        ],
      }),
    ).toThrow('Location end must be at least start');
    expect(() =>
      screenplayConversionReportSchema.parse({ ...invalid, schemaVersion: 2 }),
    ).toThrow();
  });

  it('normalizes reservation formats and validates immutable completion input', () => {
    expect(
      reserveScreenplayImportArtifactSchema.parse({
        originalFilename: '  Pilot.DOCX  ',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 42,
        sourceFormat: ' DOCX ',
      }),
    ).toMatchObject({ originalFilename: 'Pilot.DOCX', sourceFormat: 'docx' });
    expect(
      completeScreenplayImportArtifactSchema.parse({
        version: 1,
        convertedFountain: 'INT. ROOM - DAY\n',
        report: report(),
      }).report.schemaVersion,
    ).toBe(SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION);
  });
});
