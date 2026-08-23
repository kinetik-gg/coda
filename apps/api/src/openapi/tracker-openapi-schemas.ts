import {
  createFieldOptionSchema,
  createTrackerCommentSchema,
  createTrackerFieldSchema,
  createTrackerRecordSchema,
  reorderTrackerRecordSchema,
  setTrackerRecordFieldValueSchema,
  bulkDeleteTrackerRecordsSchema,
  bulkSetTrackerRecordValuesSchema,
  reorderTrackerFieldSchema,
  archiveTrackerFieldSchema,
  updateTrackerCommentSchema,
  updateTrackerFieldOptionSchema,
  updateTrackerFieldSchema,
  updateTrackerRecordSchema,
} from '@coda/contracts';
import { z, type ZodType } from 'zod';

type JsonObject = Record<string, unknown>;

function contractSchema(schema: ZodType): JsonObject {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as JsonObject;
  delete jsonSchema.$schema;
  return jsonSchema;
}

const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const version = { type: 'integer', minimum: 1 };
const rank = { type: 'string', description: 'Opaque fractional rank. Do not edit directly.' };

const trackerFieldValue = {
  type: 'object',
  required: ['id', 'recordId', 'fieldId'],
  properties: {
    id: uuid,
    recordId: uuid,
    fieldId: uuid,
    textValue: { type: ['string', 'null'] },
    integerValue: { type: ['integer', 'null'] },
    floatValue: { type: ['number', 'null'] },
    booleanValue: { type: ['boolean', 'null'] },
    dateValue: { type: ['string', 'null'], format: 'date' },
    optionId: { oneOf: [uuid, { type: 'null' }] },
    storageObjectId: { oneOf: [uuid, { type: 'null' }] },
    option: { $ref: '#/components/schemas/TrackerFieldOption' },
    options: {
      type: 'array',
      items: { $ref: '#/components/schemas/TrackerFieldOption' },
    },
  },
};

/**
 * Response and request schemas for the tracker fields/records surface, split out of
 * `external-openapi-schemas.ts` the same way its paths are split into `trackers-openapi.ts`.
 */
export const trackerFieldOpenApiSchemas: JsonObject = {
  TrackerFieldOption: {
    type: 'object',
    required: ['id', 'label'],
    properties: {
      id: uuid,
      label: { type: 'string', minLength: 1, maxLength: 120 },
      color: { type: ['string', 'null'], maxLength: 32 },
      position: rank,
    },
  },
  TrackerField: {
    type: 'object',
    required: ['id', 'name', 'key', 'type', 'required', 'position', 'version'],
    properties: {
      id: uuid,
      name: { type: 'string', minLength: 1, maxLength: 120 },
      key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
      type: {
        type: 'string',
        enum: [
          'TEXT',
          'LONG_TEXT',
          'ENUM',
          'MULTI_ENUM',
          'INTEGER',
          'FLOAT',
          'BOOLEAN',
          'DATE',
          'FILE',
          'IMAGE',
          'VIDEO',
        ],
      },
      required: { type: 'boolean' },
      configuration: { type: 'object', additionalProperties: true },
      position: rank,
      version,
      options: { type: 'array', items: { $ref: '#/components/schemas/TrackerFieldOption' } },
    },
  },
  TrackerFieldList: {
    type: 'array',
    items: { $ref: '#/components/schemas/TrackerField' },
  },
  TrackerRecord: {
    type: 'object',
    required: ['id', 'title', 'position', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      title: { type: 'string', minLength: 1, maxLength: 300 },
      position: rank,
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
      values: { type: 'array', items: trackerFieldValue },
    },
  },
  TrackerRecordList: {
    type: 'array',
    items: { $ref: '#/components/schemas/TrackerRecord' },
  },
  TrackerComment: {
    // `authorId` is a plain column (no User relation) per the appended-table backup convention in
    // schema.prisma, so the payload cannot embed an author object the way breakdown comments do.
    type: 'object',
    required: ['id', 'recordId', 'authorId', 'body', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      recordId: uuid,
      authorId: uuid,
      body: { type: 'string' },
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
      editedAt: { oneOf: [timestamp, { type: 'null' }] },
    },
  },
  TrackerCommentList: {
    type: 'array',
    items: { $ref: '#/components/schemas/TrackerComment' },
  },
  TrackerCommentDeleteResult: {
    type: 'object',
    required: ['id', 'deletedAt'],
    properties: {
      id: uuid,
      deletedAt: timestamp,
    },
  },
  ArchiveResult: {
    type: 'object',
    required: ['id', 'archivedAt'],
    properties: {
      id: uuid,
      archivedAt: timestamp,
    },
  },
  BulkSetTrackerRecordValuesResult: {
    type: 'object',
    required: ['records'],
    properties: {
      records: { $ref: '#/components/schemas/TrackerRecordList' },
    },
  },
  BulkDeleteTrackerRecordsResult: {
    type: 'object',
    required: ['deletedIds', 'deletionBatchId'],
    properties: {
      deletedIds: { type: 'array', items: uuid },
      deletionBatchId: uuid,
    },
  },
  CreateTrackerFieldInput: contractSchema(createTrackerFieldSchema),
  CreateTrackerFieldOptionInput: contractSchema(createFieldOptionSchema),
  UpdateTrackerFieldInput: contractSchema(updateTrackerFieldSchema),
  ReorderTrackerFieldInput: contractSchema(reorderTrackerFieldSchema),
  ArchiveTrackerFieldInput: contractSchema(archiveTrackerFieldSchema),
  UpdateTrackerFieldOptionInput: contractSchema(updateTrackerFieldOptionSchema),
  CreateTrackerRecordInput: contractSchema(createTrackerRecordSchema),
  UpdateTrackerRecordInput: contractSchema(updateTrackerRecordSchema),
  ReorderTrackerRecordInput: contractSchema(reorderTrackerRecordSchema),
  SetTrackerRecordFieldValueInput: contractSchema(setTrackerRecordFieldValueSchema),
  BulkSetTrackerRecordValuesInput: contractSchema(bulkSetTrackerRecordValuesSchema),
  BulkDeleteTrackerRecordsInput: contractSchema(bulkDeleteTrackerRecordsSchema),
  CreateTrackerCommentInput: contractSchema(createTrackerCommentSchema),
  UpdateTrackerCommentInput: contractSchema(updateTrackerCommentSchema),
};
