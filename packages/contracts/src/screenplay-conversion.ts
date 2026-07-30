import { z } from 'zod';

export const SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION = 1;
export const SCREENPLAY_CONVERSION_MAX_ELEMENTS = 50_000;
export const SCREENPLAY_CONVERSION_MAX_WARNINGS = 1_000;
export const SCREENPLAY_CONVERSION_MAX_SOURCE_CHARACTERS = 5_000_000;

export const screenplaySourceFormatSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.+_-]*$/u);

export const screenplayConversionStatusSchema = z.enum([
  'preserved',
  'converted',
  'uncertain',
  'unsupported',
]);

export const screenplayConversionLocationUnitSchema = z.enum([
  'byte',
  'character',
  'line',
  'page',
  'paragraph',
]);

/**
 * A zero-based, half-open location in either the original document or converted
 * Fountain snapshot. Keeping ranges unit-tagged lets every adapter share one
 * report without pretending a DOCX paragraph and a PDF page are interchangeable.
 */
export const screenplayConversionLocationSchema = z
  .object({
    unit: screenplayConversionLocationUnitSchema,
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .refine((location) => location.end >= location.start, {
    message: 'Location end must be at least start',
    path: ['end'],
  });

export const screenplayConversionWarningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(1_000),
});

const screenplayConversionElementLocationSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  location: screenplayConversionLocationSchema,
});

export const screenplayConversionElementSchema = z.object({
  id: z.string().trim().min(1).max(120),
  status: screenplayConversionStatusSchema,
  source: screenplayConversionElementLocationSchema,
  target: screenplayConversionElementLocationSchema.nullable(),
  summary: z.string().trim().min(1).max(2_000),
  warnings: z.array(screenplayConversionWarningSchema).max(20),
});

export const screenplayConversionSummarySchema = z.object({
  total: z.number().int().min(0),
  preserved: z.number().int().min(0),
  converted: z.number().int().min(0),
  uncertain: z.number().int().min(0),
  unsupported: z.number().int().min(0),
});

export const screenplayConversionReportSchema = z
  .object({
    schemaVersion: z.literal(SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION),
    sourceFormat: screenplaySourceFormatSchema,
    adapter: z.object({
      id: z.string().trim().min(1).max(120),
      version: z.string().trim().min(1).max(64),
    }),
    generatedAt: z.string().datetime({ offset: true }),
    summary: screenplayConversionSummarySchema,
    warnings: z.array(screenplayConversionWarningSchema).max(SCREENPLAY_CONVERSION_MAX_WARNINGS),
    elements: z.array(screenplayConversionElementSchema).max(SCREENPLAY_CONVERSION_MAX_ELEMENTS),
  })
  .superRefine((report, context) => {
    const actual = {
      preserved: 0,
      converted: 0,
      uncertain: 0,
      unsupported: 0,
    };
    for (const element of report.elements) actual[element.status] += 1;
    const expected = { ...actual, total: report.elements.length };
    for (const [key, value] of Object.entries(expected)) {
      if (report.summary[key as keyof typeof expected] !== value) {
        context.addIssue({
          code: 'custom',
          path: ['summary', key],
          message: `Summary ${key} does not match conversion elements`,
        });
      }
    }
  });

export const reserveScreenplayImportArtifactSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  sourceFormat: screenplaySourceFormatSchema,
});

export const completeScreenplayImportArtifactSchema = z.object({
  version: z.number().int().min(1),
  convertedFountain: z
    .string()
    .max(SCREENPLAY_CONVERSION_MAX_SOURCE_CHARACTERS)
    .describe('Immutable initial UTF-8 Fountain snapshot produced by the adapter.'),
  report: screenplayConversionReportSchema,
});

export type ScreenplaySourceFormat = z.infer<typeof screenplaySourceFormatSchema>;
export type ScreenplayConversionStatus = z.infer<typeof screenplayConversionStatusSchema>;
export type ScreenplayConversionLocation = z.infer<typeof screenplayConversionLocationSchema>;
export type ScreenplayConversionWarning = z.infer<typeof screenplayConversionWarningSchema>;
export type ScreenplayConversionElement = z.infer<typeof screenplayConversionElementSchema>;
export type ScreenplayConversionReport = z.infer<typeof screenplayConversionReportSchema>;
export type ReserveScreenplayImportArtifact = z.infer<typeof reserveScreenplayImportArtifactSchema>;
export type CompleteScreenplayImportArtifact = z.infer<
  typeof completeScreenplayImportArtifactSchema
>;
