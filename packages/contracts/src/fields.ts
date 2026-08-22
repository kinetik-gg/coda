import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './primitives';

/**
 * Shared field-definition machinery (type vocabulary, configuration bag, option payloads, and
 * typed value inputs). Breakdown and tracker fields share all of it, so it lives in its own leaf
 * module — a domain module can depend on these shapes without importing the barrel, which would
 * be a cycle.
 */

export const fieldTypeSchema = z.enum([
  'text',
  'long_text',
  'enum',
  'multi_enum',
  'integer',
  'float',
  'boolean',
  'date',
  'file',
  'image',
  'video',
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const fieldConfigurationSchema = z.record(z.string(), z.unknown()).default({});

export const createFieldOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  color: z.string().trim().max(32).nullable().optional(),
});

export const updateFieldOptionSchema = createFieldOptionSchema.extend({
  id: uuidSchema.optional(),
});

export const validateFieldOptions = (
  type: FieldType,
  options: Array<{ label: string }> | undefined,
  context: z.RefinementCtx,
) => {
  if (options?.length && type !== 'enum' && type !== 'multi_enum') {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Options are only supported by enum and multi-enum fields',
    });
  }
  if (options) {
    const labels = options.map((option) => option.label.toLocaleLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Option labels must be unique',
      });
    }
  }
};

export const fieldValueInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('long_text'), value: z.string() }),
  z.object({
    type: z.literal('integer'),
    value: z.number().int().min(-2147483648).max(2147483647),
  }),
  z.object({ type: z.literal('float'), value: z.number().finite() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({ type: z.literal('date'), value: isoDateSchema }),
  z.object({ type: z.literal('enum'), optionId: uuidSchema }),
  z.object({
    type: z.literal('multi_enum'),
    optionIds: z
      .array(uuidSchema)
      .max(100)
      .refine((optionIds) => new Set(optionIds).size === optionIds.length, {
        message: 'Option IDs must be unique',
      }),
  }),
  z.object({ type: z.enum(['file', 'image', 'video']), storageObjectId: uuidSchema }),
]);
export type FieldValueInput = z.infer<typeof fieldValueInputSchema>;
