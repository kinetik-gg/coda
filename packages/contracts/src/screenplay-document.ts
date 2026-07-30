import { z } from 'zod';
import { uuidSchema } from './primitives';
import { spaceResourceTargetSchema } from './space-resource-requests';

/**
 * Screenplay document contracts: create, update, checkpoint, Fountain import,
 * and list paging. Moved out of the barrel unchanged so `index.ts` stays under
 * its line cap; every name here is still re-exported from `@coda/contracts`.
 */

const screenplayTitleSchema = z.string().trim().min(1).max(160);
export const screenplayPaperSizeSchema = z.enum(['letter', 'a4']);
export type ScreenplayPaperSize = z.infer<typeof screenplayPaperSizeSchema>;
export const FOUNTAIN_SOURCE_MAX_CHARACTERS = 5_000_000;
export const SCREENPLAY_LIST_DEFAULT_LIMIT = 50;
export const SCREENPLAY_LIST_MAX_LIMIT = 100;
const fountainSourceSchema = z
  .string()
  .max(FOUNTAIN_SOURCE_MAX_CHARACTERS)
  .describe('Canonical UTF-8 Fountain source text.');

export const createScreenplaySchema = spaceResourceTargetSchema.extend({
  title: screenplayTitleSchema,
  sourceText: fountainSourceSchema.optional(),
  paperSize: screenplayPaperSizeSchema.optional(),
});
export type CreateScreenplay = z.infer<typeof createScreenplaySchema>;

export const updateScreenplaySchema = z
  .object({
    title: screenplayTitleSchema.optional(),
    sourceText: fountainSourceSchema.optional(),
    paperSize: screenplayPaperSizeSchema.optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.sourceText !== undefined || value.paperSize !== undefined,
    {
      message: 'At least one screenplay field is required',
    },
  );
export type UpdateScreenplay = z.infer<typeof updateScreenplaySchema>;

export const createScreenplayCheckpointSchema = z.object({
  version: z.number().int().min(1),
});
export type CreateScreenplayCheckpoint = z.infer<typeof createScreenplayCheckpointSchema>;

export const screenplayCheckpointSchema = z.object({
  id: z.string().uuid(),
  screenplayId: z.string().uuid(),
  screenplayVersion: z.number().int().min(1),
  filename: z.string().min(1).max(255),
  paperSize: screenplayPaperSizeSchema,
  sourceByteLength: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
});
export type ScreenplayCheckpoint = z.infer<typeof screenplayCheckpointSchema>;

export const importScreenplaySchema = spaceResourceTargetSchema.extend({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((filename) => /\.(?:fountain|spmd|txt)$/i.test(filename), {
      message: 'Filename must use .fountain, .spmd, or .txt',
    })
    .describe('Fountain-compatible filename ending in .fountain, .spmd, or .txt.'),
  sourceText: fountainSourceSchema,
  paperSize: screenplayPaperSizeSchema.optional(),
});
export type ImportScreenplay = z.infer<typeof importScreenplaySchema>;

export const listScreenplaysQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  spaceId: uuidSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCREENPLAY_LIST_MAX_LIMIT)
    .default(SCREENPLAY_LIST_DEFAULT_LIMIT),
});
export type ListScreenplaysQuery = z.infer<typeof listScreenplaysQuerySchema>;
