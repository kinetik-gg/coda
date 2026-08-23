import { z } from 'zod';
import {
  fieldConfigurationSchema,
  fieldDefinitionBodySchema,
  fieldValueInputSchema,
  updateFieldOptionSchema,
  validateFieldOptions,
} from './fields';
import { isoDateSchema, uuidSchema } from './primitives';
import { trackerPermissionSchema } from './tracker-permissions';
import { spaceResourceTargetSchema } from './space-resource-requests';
import {
  queryFiltersParamSchema,
  refineQueryFilterValue,
  workspaceFilterOperatorSchema,
} from './workspace-layout';

// Tracker contracts: a tracker is a flat record grid inside a Space — user-defined fields,
// records holding one value per field, comments on records, and an activity stream. Shapes mirror
// their breakdown counterparts where the concept is identical (field definitions/options/values
// come straight from ./fields) so the two surfaces stay vocabulary-compatible.

const trackerNameSchema = z.string().trim().min(1).max(200);
const trackerDescriptionSchema = z.string().trim().max(1000).nullable().optional();
const trackerFieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,63}$/);
const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const createTrackerSchema = spaceResourceTargetSchema.extend({
  name: trackerNameSchema,
  description: trackerDescriptionSchema,
});
export type CreateTracker = z.infer<typeof createTrackerSchema>;

export const updateTrackerSchema = z
  .object({
    name: trackerNameSchema.optional(),
    description: trackerDescriptionSchema,
    version: z.number().int().min(1),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'At least one tracker field is required',
  });
export type UpdateTracker = z.infer<typeof updateTrackerSchema>;

export const listTrackersQuerySchema = z.object({ spaceId: uuidSchema.optional() });
export type ListTrackersQuery = z.infer<typeof listTrackersQuerySchema>;

// --- Field definitions -------------------------------------------------------

export const createTrackerFieldSchema = fieldDefinitionBodySchema.superRefine((field, context) =>
  validateFieldOptions(field.type, field.options, context),
);
export type CreateTrackerField = z.infer<typeof createTrackerFieldSchema>;

export const updateTrackerFieldSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  key: trackerFieldKeySchema.optional(),
  required: z.boolean().optional(),
  configuration: fieldConfigurationSchema.optional(),
  options: z.array(updateFieldOptionSchema).max(250).optional(),
  version: z.number().int().min(1),
});
export type UpdateTrackerField = z.infer<typeof updateTrackerFieldSchema>;

export const archiveTrackerFieldSchema = z.object({ version: z.number().int().min(1) });
export type ArchiveTrackerField = z.infer<typeof archiveTrackerFieldSchema>;

/**
 * Rank-string reorder bodies, mirroring the breakdown reorder contract (`reorderFieldSchema` in
 * ./index would be a barrel import and a cycle, so the shapes are restated here).
 */
export const reorderTrackerFieldSchema = z.object({
  beforeId: uuidSchema.nullable().optional(),
  afterId: uuidSchema.nullable().optional(),
  version: z.number().int().min(1),
});
export type ReorderTrackerField = z.infer<typeof reorderTrackerFieldSchema>;

// --- Field options -----------------------------------------------------------

export const updateTrackerFieldOptionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(32).nullable().optional(),
});
export type UpdateTrackerFieldOption = z.infer<typeof updateTrackerFieldOptionSchema>;

// --- Records -----------------------------------------------------------------

/** Position rank strings (`beforeId`/`afterId`), mirroring the breakdown reorder contract. */
export const createTrackerRecordSchema = z.object({
  title: z.string().trim().min(1).max(300),
  beforeId: uuidSchema.optional(),
  afterId: uuidSchema.optional(),
});
export type CreateTrackerRecord = z.infer<typeof createTrackerRecordSchema>;

export const updateTrackerRecordSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  beforeId: uuidSchema.nullable().optional(),
  afterId: uuidSchema.nullable().optional(),
  version: z.number().int().min(1),
});
export type UpdateTrackerRecord = z.infer<typeof updateTrackerRecordSchema>;

export const reorderTrackerRecordSchema = z.object({
  beforeId: uuidSchema.nullable().optional(),
  afterId: uuidSchema.nullable().optional(),
  version: z.number().int().min(1),
});
export type ReorderTrackerRecord = z.infer<typeof reorderTrackerRecordSchema>;

export const setTrackerRecordFieldValueSchema = z.object({
  value: fieldValueInputSchema.nullable(),
  recordVersion: z.number().int().min(1),
});
export type SetTrackerRecordFieldValue = z.infer<typeof setTrackerRecordFieldValueSchema>;

export const bulkDeleteTrackerRecordsSchema = z
  .object({ ids: z.array(uuidSchema).min(1).max(250).refine(uniqueIds) })
  .strict();
export type BulkDeleteTrackerRecords = z.infer<typeof bulkDeleteTrackerRecordsSchema>;

export const bulkSetTrackerRecordValuesSchema = z
  .object({
    updates: z
      .array(
        z.object({
          recordId: uuidSchema,
          fieldId: uuidSchema,
          value: fieldValueInputSchema.nullable(),
        }),
      )
      .min(1)
      .max(500)
      .refine(
        (updates) => {
          const pairs = updates.map(({ recordId, fieldId }) => `${recordId}:${fieldId}`);
          return new Set(pairs).size === pairs.length;
        },
        { message: 'Each record field may only be set once' },
      ),
  })
  .strict();
export type BulkSetTrackerRecordValues = z.infer<typeof bulkSetTrackerRecordValuesSchema>;

// --- List queries ------------------------------------------------------------

export const trackerRecordFilterSchema = z
  .object({
    fieldId: uuidSchema,
    operator: workspaceFilterOperatorSchema,
    value: z.unknown().optional(),
  })
  .superRefine(refineQueryFilterValue);
export type TrackerRecordFilter = z.infer<typeof trackerRecordFilterSchema>;

export const listTrackerRecordsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  sort: z.enum(['manual', 'title', 'created_at', 'updated_at']).default('manual'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(200).optional(),
  filters: queryFiltersParamSchema(trackerRecordFilterSchema, 20).default([]),
});
export type ListTrackerRecordsQuery = z.infer<typeof listTrackerRecordsQuerySchema>;

/**
 * Query for the record CSV export: the records-list vocabulary minus pagination. An export always
 * streams every matching row, so carrying `cursor` or `limit` is rejected rather than ignored.
 */
export const exportTrackerRecordsQuerySchema = z
  .object(listTrackerRecordsQuerySchema.omit({ cursor: true, limit: true }).shape)
  .strict();
export type ExportTrackerRecordsQuery = z.infer<typeof exportTrackerRecordsQuerySchema>;

// --- Comments ----------------------------------------------------------------

export const listTrackerCommentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});
export type ListTrackerCommentsQuery = z.infer<typeof listTrackerCommentsQuerySchema>;

export const createTrackerCommentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
export type CreateTrackerComment = z.infer<typeof createTrackerCommentSchema>;

export const updateTrackerCommentSchema = createTrackerCommentSchema.extend({
  version: z.number().int().min(1),
});
export type UpdateTrackerComment = z.infer<typeof updateTrackerCommentSchema>;

// --- Activity ----------------------------------------------------------------

export const trackerActivityActionSchema = z.enum([
  'CREATED',
  'UPDATED',
  'DELETED',
  'RESTORED',
  'COMMENTED',
]);
export type TrackerActivityAction = z.infer<typeof trackerActivityActionSchema>;

export const trackerActivityItemSchema = z
  .object({
    id: uuidSchema,
    trackerId: uuidSchema,
    actorId: uuidSchema.nullable(),
    action: trackerActivityActionSchema,
    resourceType: z.string().max(80),
    resourceId: uuidSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: isoDateSchema,
  })
  .strict();
export type TrackerActivityItem = z.infer<typeof trackerActivityItemSchema>;

// --- Sharing -----------------------------------------------------------------

/**
 * Emitted to a socket the realtime gateway forces out of `tracker:<id>` after a role change,
 * membership removal, or ownership transfer invalidated the access it joined with — the tracker
 * twin of `SCREENPLAY_ACCESS_CHANGED_EVENT`.
 */
export const TRACKER_ACCESS_CHANGED_EVENT = 'tracker-access-changed';

// Custom role bodies over the tracker vocabulary (`trackerPermissionSchema`), shaped like the
// Space role contracts; the owner role itself is never creatable or editable.
export const createTrackerRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z
    .array(trackerPermissionSchema)
    .min(1)
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: 'Permissions must be unique',
    }),
});
export type CreateTrackerRole = z.infer<typeof createTrackerRoleSchema>;

export const updateTrackerRoleSchema = createTrackerRoleSchema
  .partial()
  .extend({ version: z.number().int().min(1) });
export type UpdateTrackerRole = z.infer<typeof updateTrackerRoleSchema>;
