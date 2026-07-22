import {
  completeUploadSchema,
  createCommentSchema,
  createEntityTypeSchema,
  createFieldDefinitionSchema,
  createItemSchema,
  createSourceDocumentSchema,
  createSourceReferenceSchema,
  createUploadSchema,
  reorderFieldSchema,
  reorderSchema,
  setFieldValueSchema,
  updateCommentSchema,
  updateEntityTypeSchema,
  updateFieldDefinitionSchema,
  updateItemSchema,
  updateProjectSchema,
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

export const externalOpenApiSchemas: JsonObject = {
  ProblemDetails: {
    type: 'object',
    required: ['type', 'title', 'status'],
    properties: {
      type: { type: 'string', format: 'uri-reference' },
      title: { type: 'string' },
      status: { type: 'integer', minimum: 400, maximum: 599 },
      detail: { type: 'string' },
      instance: { type: 'string' },
      requestId: { type: 'string', format: 'uuid' },
      errors: {
        type: 'object',
        additionalProperties: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  DataEnvelope: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {},
      meta: {
        type: 'object',
        description: 'Pagination or response metadata when present.',
        additionalProperties: true,
        properties: {
          nextCursor: { type: ['string', 'null'] },
        },
      },
    },
  },
  TokenContext: {
    type: 'object',
    required: ['projectId', 'kind', 'permissions'],
    properties: {
      projectId: uuid,
      kind: { type: 'string', enum: ['API_KEY', 'MCP_TOKEN'] },
      permissions: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    },
  },
  Project: {
    type: 'object',
    required: ['id', 'name', 'version', 'revision', 'entityTypes', 'sourceDocuments'],
    properties: {
      id: uuid,
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      version,
      revision: { type: 'integer', minimum: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
      entityTypes: { type: 'array', items: { $ref: '#/components/schemas/EntityType' } },
      sourceDocuments: {
        type: 'array',
        maxItems: 1,
        items: { $ref: '#/components/schemas/SourceDocument' },
      },
    },
  },
  EntityType: {
    type: 'object',
    required: [
      'id',
      'projectId',
      'singularName',
      'pluralName',
      'level',
      'position',
      'enabled',
      'version',
    ],
    properties: {
      id: uuid,
      projectId: uuid,
      parentTypeId: { oneOf: [uuid, { type: 'null' }] },
      singularName: { type: 'string' },
      pluralName: { type: 'string' },
      displayPrefix: { type: ['string', 'null'] },
      level: { type: 'integer', minimum: 1, maximum: 3 },
      position: rank,
      enabled: { type: 'boolean' },
      version,
      _count: {
        type: 'object',
        properties: { items: { type: 'integer', minimum: 0 } },
      },
    },
  },
  Item: {
    type: 'object',
    required: ['id', 'projectId', 'entityTypeId', 'title', 'position', 'version'],
    properties: {
      id: uuid,
      projectId: uuid,
      entityTypeId: uuid,
      parentId: { oneOf: [uuid, { type: 'null' }] },
      title: { type: 'string' },
      displayCode: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      position: rank,
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
      values: { type: 'array', items: { type: 'object' } },
      sourceReferences: {
        type: 'array',
        items: { $ref: '#/components/schemas/SourceReference' },
      },
    },
  },
  ItemList: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
  FieldOption: {
    type: 'object',
    required: ['id', 'label', 'position'],
    properties: {
      id: uuid,
      label: { type: 'string' },
      color: { type: ['string', 'null'] },
      position: rank,
    },
  },
  Field: {
    type: 'object',
    required: ['id', 'entityTypeId', 'name', 'key', 'type', 'required', 'position', 'version'],
    properties: {
      id: uuid,
      projectId: uuid,
      entityTypeId: uuid,
      name: { type: 'string' },
      key: { type: 'string' },
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
      options: { type: 'array', items: { $ref: '#/components/schemas/FieldOption' } },
    },
  },
  FieldList: { type: 'array', items: { $ref: '#/components/schemas/Field' } },
  StorageObject: {
    type: 'object',
    required: [
      'id',
      'projectId',
      'kind',
      'originalFilename',
      'mimeType',
      'sizeBytes',
      'status',
      'version',
    ],
    properties: {
      id: uuid,
      projectId: uuid,
      kind: { type: 'string' },
      originalFilename: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: {
        oneOf: [
          { type: 'integer', minimum: 0 },
          { type: 'string', pattern: '^[0-9]+$' },
        ],
      },
      status: { type: 'string', enum: ['PENDING', 'READY', 'FAILED'] },
      version,
    },
  },
  UploadReservation: {
    allOf: [
      { $ref: '#/components/schemas/StorageObject' },
      {
        type: 'object',
        required: ['uploadUrl', 'expiresIn'],
        properties: {
          uploadUrl: { type: 'string', format: 'uri' },
          expiresIn: { type: 'integer', minimum: 1, description: 'Seconds until expiry.' },
        },
      },
    ],
  },
  SignedUrl: {
    type: 'object',
    required: ['url', 'expiresIn'],
    properties: {
      url: { type: 'string', format: 'uri' },
      expiresIn: { type: 'integer', minimum: 1, description: 'Seconds until expiry.' },
    },
  },
  SourceDocument: {
    type: 'object',
    required: ['id', 'projectId', 'storageObjectId', 'title', 'version'],
    properties: {
      id: uuid,
      projectId: uuid,
      storageObjectId: uuid,
      title: { type: 'string' },
      pageCount: { type: ['integer', 'null'], minimum: 1 },
      version,
      createdAt: timestamp,
      storageObject: { $ref: '#/components/schemas/StorageObject' },
    },
  },
  SourceReference: {
    type: 'object',
    required: ['id', 'itemId', 'sourceDocumentId', 'startPage', 'endPage', 'position'],
    properties: {
      id: uuid,
      itemId: uuid,
      sourceDocumentId: uuid,
      startPage: { type: 'integer', minimum: 1 },
      endPage: { type: 'integer', minimum: 1 },
      position: rank,
    },
  },
  Comment: {
    type: 'object',
    required: ['id', 'itemId', 'authorId', 'body', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid,
      itemId: uuid,
      authorId: uuid,
      body: { type: 'string' },
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  },
  CommentList: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
  ActivityEvent: {
    type: 'object',
    required: ['id', 'projectId', 'action', 'resourceType', 'createdAt'],
    properties: {
      id: uuid,
      projectId: uuid,
      actorId: { oneOf: [uuid, { type: 'null' }] },
      action: { type: 'string' },
      resourceType: { type: 'string' },
      resourceId: { oneOf: [uuid, { type: 'null' }] },
      metadata: {},
      createdAt: timestamp,
      actor: {
        oneOf: [
          {
            type: 'object',
            required: ['id', 'displayName'],
            properties: { id: uuid, displayName: { type: 'string' } },
          },
          { type: 'null' },
        ],
      },
    },
  },
  ActivityList: {
    type: 'array',
    maxItems: 100,
    items: { $ref: '#/components/schemas/ActivityEvent' },
  },
  RemovalResult: {
    type: 'object',
    required: ['removed'],
    properties: { removed: { type: 'boolean', const: true } },
  },
  UpdateProjectInput: contractSchema(updateProjectSchema),
  CreateEntityTypeInput: contractSchema(createEntityTypeSchema),
  UpdateEntityTypeInput: contractSchema(updateEntityTypeSchema),
  CreateItemInput: contractSchema(createItemSchema),
  UpdateItemInput: contractSchema(updateItemSchema),
  ReorderItemInput: contractSchema(reorderSchema),
  CreateFieldInput: contractSchema(createFieldDefinitionSchema),
  UpdateFieldInput: contractSchema(updateFieldDefinitionSchema),
  ReorderFieldInput: contractSchema(reorderFieldSchema),
  SetFieldValueInput: contractSchema(setFieldValueSchema),
  CreateUploadInput: contractSchema(createUploadSchema),
  CompleteUploadInput: contractSchema(completeUploadSchema),
  CreateSourceDocumentInput: contractSchema(createSourceDocumentSchema),
  CreateSourceReferenceInput: contractSchema(createSourceReferenceSchema),
  CreateCommentInput: contractSchema(createCommentSchema),
  UpdateCommentInput: contractSchema(updateCommentSchema),
};
