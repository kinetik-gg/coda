import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const tokenContextSchema = z.object({
  projectId: uuidSchema,
  kind: z.literal('MCP_TOKEN'),
  permissions: z.array(z.string().min(1).max(80)).max(100),
});

export const projectSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    description: z.string().nullable().optional(),
    version: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.string(),
    entityTypes: z.array(
      z
        .object({
          id: uuidSchema,
          parentTypeId: uuidSchema.nullable(),
          singularName: z.string(),
          pluralName: z.string(),
          displayPrefix: z.string().nullable(),
          level: z.number().int().min(1).max(3),
          position: z.string(),
          enabled: z.boolean(),
          version: z.number().int().positive(),
          _count: z.object({ items: z.number().int().nonnegative() }).optional(),
        })
        .passthrough(),
    ),
    sourceDocuments: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const fieldSchema = z
  .object({
    id: uuidSchema,
    entityTypeId: uuidSchema,
    name: z.string(),
    key: z.string(),
    type: z.string(),
    required: z.boolean(),
    position: z.string(),
    configuration: z.unknown(),
    version: z.number().int().positive(),
    options: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const sourceDocumentSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    pageCount: z.number().int().positive().nullable().optional(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    storageObject: z
      .object({
        id: uuidSchema,
        originalFilename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.union([z.number().int().nonnegative(), z.string()]),
        status: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const itemListInputSchema = z.object({
  entityTypeId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  cursor: z.string().min(1).max(1_024).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  sort: z.enum(['manual', 'title', 'code', 'created_at', 'updated_at']).default('manual'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().min(1).max(200).optional(),
});

export const itemCreateInputSchema = z.object({
  entityTypeId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1).max(300),
  displayCode: z.string().trim().max(80).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  beforeId: uuidSchema.optional(),
  afterId: uuidSchema.optional(),
});

export const itemUpdateInputSchema = z
  .object({
    itemId: uuidSchema,
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(300).optional(),
    displayCode: z.string().trim().max(80).nullable().optional(),
    description: z.string().max(20_000).nullable().optional(),
    parentId: uuidSchema.nullable().optional(),
  })
  .refine(
    ({ title, displayCode, description, parentId }) =>
      title !== undefined ||
      displayCode !== undefined ||
      description !== undefined ||
      parentId !== undefined,
    { message: 'At least one editable field is required' },
  );

export const activityListInputSchema = z.object({
  cursor: z.string().uuid().optional(),
});

export type ItemListInput = z.infer<typeof itemListInputSchema>;
export type ItemCreateInput = z.infer<typeof itemCreateInputSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateInputSchema>;
