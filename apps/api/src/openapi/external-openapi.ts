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

const problemResponses = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '429': { $ref: '#/components/responses/TooManyRequests' },
  '500': { $ref: '#/components/responses/InternalServerError' },
};

const projectIdParameter = { $ref: '#/components/parameters/ProjectId' };
const entityTypeIdParameter = { $ref: '#/components/parameters/EntityTypeId' };
const itemIdParameter = { $ref: '#/components/parameters/ItemId' };
const fieldIdParameter = { $ref: '#/components/parameters/FieldId' };

function jsonBody(schemaName: string): JsonObject {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

function dataResponse(schemaName: string, description: string): JsonObject {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          allOf: [
            { $ref: '#/components/schemas/DataEnvelope' },
            {
              type: 'object',
              properties: { data: { $ref: `#/components/schemas/${schemaName}` } },
            },
          ],
        },
      },
    },
  };
}

function operation(
  operationId: string,
  summary: string,
  tag: string,
  responseSchema: string,
  options: {
    parameters?: JsonObject[];
    requestSchema?: string;
    successStatus?: '200' | '201';
    description?: string;
  } = {},
): JsonObject {
  const successStatus = options.successStatus ?? '200';
  return {
    operationId,
    summary,
    tags: [tag],
    security: [{ bearerAuth: [] }],
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.requestSchema ? { requestBody: jsonBody(options.requestSchema) } : {}),
    responses: {
      [successStatus]: dataResponse(
        responseSchema,
        options.description ?? (successStatus === '201' ? 'Created.' : 'Successful response.'),
      ),
      ...problemResponses,
    },
  };
}

function problemResponse(description: string): JsonObject {
  return {
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  };
}

const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const version = { type: 'integer', minimum: 1 };
const rank = { type: 'string', description: 'Opaque fractional rank. Do not edit directly.' };

const externalOpenApiDocument: JsonObject = {
  openapi: '3.1.0',
  info: {
    title: 'Coda External API',
    version: '1.0.0',
    summary: 'Project-scoped API for source breakdown data.',
    description:
      'The documented surface accepts project-bound API keys and MCP tokens. It intentionally excludes setup, account, session, instance administration, membership, role, invitation, ownership-transfer, workspace-layout, import, trash, and purge operations.',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: '/', description: 'The Coda instance that issued the credential.' }],
  tags: [
    { name: 'Credential', description: 'Inspect the active project-scoped credential.' },
    { name: 'Project', description: 'Read or update the bound project.' },
    { name: 'Schema', description: 'Manage hierarchy levels and custom fields.' },
    { name: 'Items', description: 'List, create, edit, order, and populate breakdown items.' },
    { name: 'Source', description: 'Upload files and attach source-page references.' },
    { name: 'Collaboration', description: 'Work with comments and the project activity feed.' },
    { name: 'Exports', description: 'Download project data.' },
  ],
  paths: {
    '/api/v1/openapi.json': {
      get: {
        operationId: 'getExternalOpenApiDocument',
        summary: 'Download this OpenAPI document',
        tags: ['Credential'],
        security: [],
        responses: {
          '200': {
            description: 'OpenAPI 3.1 document.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/api/v1/token/context': {
      get: operation('getTokenContext', 'Get credential context', 'Credential', 'TokenContext'),
    },
    '/api/v1/projects/{projectId}': {
      get: operation('getProject', 'Get the bound project and hierarchy', 'Project', 'Project', {
        parameters: [projectIdParameter],
      }),
      patch: operation('updateProject', 'Update project information', 'Project', 'Project', {
        parameters: [projectIdParameter],
        requestSchema: 'UpdateProjectInput',
      }),
    },
    '/api/v1/projects/{projectId}/entity-types': {
      post: operation(
        'createEntityType',
        'Add the deepest hierarchy level',
        'Schema',
        'EntityType',
        {
          parameters: [projectIdParameter],
          requestSchema: 'CreateEntityTypeInput',
          successStatus: '201',
        },
      ),
    },
    '/api/v1/projects/{projectId}/entity-types/{entityTypeId}': {
      patch: operation('updateEntityType', 'Update a hierarchy level', 'Schema', 'EntityType', {
        parameters: [projectIdParameter, entityTypeIdParameter],
        requestSchema: 'UpdateEntityTypeInput',
      }),
      delete: operation(
        'deleteEntityType',
        'Remove an empty deepest hierarchy level',
        'Schema',
        'RemovalResult',
        {
          parameters: [projectIdParameter, entityTypeIdParameter],
        },
      ),
    },
    '/api/v1/projects/{projectId}/items': {
      get: {
        ...operation('listItems', 'List active items', 'Items', 'ItemList', {
          parameters: [
            projectIdParameter,
            { $ref: '#/components/parameters/EntityTypeIdQuery' },
            { $ref: '#/components/parameters/ParentIdQuery' },
            { $ref: '#/components/parameters/Cursor' },
            { $ref: '#/components/parameters/Limit' },
            { $ref: '#/components/parameters/ItemSort' },
            { $ref: '#/components/parameters/SortDirection' },
            { $ref: '#/components/parameters/Search' },
            { $ref: '#/components/parameters/Filters' },
          ],
        }),
        'x-coda-zod-contract': 'listItemsQuerySchema',
      },
      post: operation('createItem', 'Create an item', 'Items', 'Item', {
        parameters: [projectIdParameter],
        requestSchema: 'CreateItemInput',
        successStatus: '201',
      }),
    },
    '/api/v1/projects/{projectId}/items/{itemId}': {
      patch: operation('updateItem', 'Update an item', 'Items', 'Item', {
        parameters: [projectIdParameter, itemIdParameter],
        requestSchema: 'UpdateItemInput',
      }),
    },
    '/api/v1/projects/{projectId}/items/{itemId}/reorder': {
      patch: operation('reorderItem', 'Move an item between siblings', 'Items', 'Item', {
        parameters: [projectIdParameter, itemIdParameter],
        requestSchema: 'ReorderItemInput',
      }),
    },
    '/api/v1/projects/{projectId}/entity-types/{entityTypeId}/fields': {
      get: operation(
        'listFields',
        'List custom fields for a hierarchy level',
        'Schema',
        'FieldList',
        {
          parameters: [projectIdParameter, entityTypeIdParameter],
        },
      ),
    },
    '/api/v1/projects/{projectId}/fields': {
      post: operation('createField', 'Create a custom field', 'Schema', 'Field', {
        parameters: [projectIdParameter],
        requestSchema: 'CreateFieldInput',
        successStatus: '201',
      }),
    },
    '/api/v1/projects/{projectId}/fields/{fieldId}': {
      get: operation('getField', 'Get a custom field', 'Schema', 'Field', {
        parameters: [projectIdParameter, fieldIdParameter],
      }),
      patch: operation('updateField', 'Update a custom field', 'Schema', 'Field', {
        parameters: [projectIdParameter, fieldIdParameter],
        requestSchema: 'UpdateFieldInput',
      }),
    },
    '/api/v1/projects/{projectId}/fields/{fieldId}/reorder': {
      patch: operation('reorderField', 'Move a custom field', 'Schema', 'Field', {
        parameters: [projectIdParameter, fieldIdParameter],
        requestSchema: 'ReorderFieldInput',
      }),
    },
    '/api/v1/projects/{projectId}/items/{itemId}/fields/{fieldId}': {
      put: operation('setFieldValue', 'Set or clear a typed field value', 'Items', 'Item', {
        parameters: [projectIdParameter, itemIdParameter, fieldIdParameter],
        requestSchema: 'SetFieldValueInput',
      }),
    },
    '/api/v1/uploads': {
      post: operation(
        'createUpload',
        'Create a direct-upload reservation',
        'Source',
        'UploadReservation',
        {
          requestSchema: 'CreateUploadInput',
          successStatus: '201',
        },
      ),
    },
    '/api/v1/projects/{projectId}/uploads/{storageObjectId}/complete': {
      post: operation(
        'completeUpload',
        'Verify and complete a direct upload',
        'Source',
        'StorageObject',
        {
          parameters: [projectIdParameter, { $ref: '#/components/parameters/StorageObjectId' }],
          requestSchema: 'CompleteUploadInput',
          successStatus: '201',
        },
      ),
    },
    '/api/v1/projects/{projectId}/storage-objects/{storageObjectId}/content': {
      get: operation(
        'getStorageObjectContentUrl',
        'Create a short-lived download URL',
        'Source',
        'SignedUrl',
        {
          parameters: [projectIdParameter, { $ref: '#/components/parameters/StorageObjectId' }],
        },
      ),
    },
    '/api/v1/projects/{projectId}/source-documents': {
      post: operation(
        'createSourceDocument',
        'Attach an uploaded PDF as the project source',
        'Source',
        'SourceDocument',
        {
          parameters: [projectIdParameter],
          requestSchema: 'CreateSourceDocumentInput',
          successStatus: '201',
        },
      ),
    },
    '/api/v1/projects/{projectId}/items/{itemId}/source-references': {
      post: operation(
        'createSourceReference',
        'Attach a source page range to an item',
        'Source',
        'SourceReference',
        {
          parameters: [projectIdParameter, itemIdParameter],
          requestSchema: 'CreateSourceReferenceInput',
          successStatus: '201',
        },
      ),
    },
    '/api/v1/projects/{projectId}/items/{itemId}/comments': {
      get: operation('listComments', 'List item comments', 'Collaboration', 'CommentList', {
        parameters: [projectIdParameter, itemIdParameter],
      }),
      post: operation('createComment', 'Add an item comment', 'Collaboration', 'Comment', {
        parameters: [projectIdParameter, itemIdParameter],
        requestSchema: 'CreateCommentInput',
        successStatus: '201',
      }),
    },
    '/api/v1/projects/{projectId}/comments/{commentId}': {
      patch: operation(
        'updateComment',
        'Update a comment authored by the credential owner',
        'Collaboration',
        'Comment',
        {
          parameters: [projectIdParameter, { $ref: '#/components/parameters/CommentId' }],
          requestSchema: 'UpdateCommentInput',
        },
      ),
    },
    '/api/v1/projects/{projectId}/activity': {
      get: operation(
        'listActivity',
        'List recent project activity',
        'Collaboration',
        'ActivityList',
        {
          parameters: [projectIdParameter, { $ref: '#/components/parameters/Cursor' }],
        },
      ),
    },
    '/api/v1/projects/{projectId}/exports/levels/{entityTypeId}.csv': {
      get: {
        operationId: 'exportLevelCsv',
        summary: 'Download one hierarchy level as CSV',
        tags: ['Exports'],
        security: [{ bearerAuth: [] }],
        parameters: [projectIdParameter, entityTypeIdParameter],
        responses: {
          '200': {
            description: 'Ordered CSV export.',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          ...problemResponses,
        },
      },
    },
    '/api/v1/projects/{projectId}/exports/project.json': {
      get: {
        operationId: 'exportProjectJson',
        summary: 'Download the active project model as JSON',
        tags: ['Exports'],
        security: [{ bearerAuth: [] }],
        parameters: [projectIdParameter],
        responses: {
          '200': {
            description: 'Project export.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...problemResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Coda API key or MCP token',
        description:
          'Use an API key by default. When using an MCP token, also send `X-Coda-Token-Audience: mcp`.',
      },
    },
    parameters: {
      ProjectId: { name: 'projectId', in: 'path', required: true, schema: uuid },
      EntityTypeId: { name: 'entityTypeId', in: 'path', required: true, schema: uuid },
      ItemId: { name: 'itemId', in: 'path', required: true, schema: uuid },
      FieldId: { name: 'fieldId', in: 'path', required: true, schema: uuid },
      StorageObjectId: { name: 'storageObjectId', in: 'path', required: true, schema: uuid },
      CommentId: { name: 'commentId', in: 'path', required: true, schema: uuid },
      EntityTypeIdQuery: { name: 'entityTypeId', in: 'query', required: true, schema: uuid },
      ParentIdQuery: {
        name: 'parentId',
        in: 'query',
        schema: { oneOf: [uuid, { type: 'string', maxLength: 0 }] },
        description:
          'Filter by parent. Use an empty value for root items; omit to include all parents.',
      },
      Cursor: { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 1024 } },
      Limit: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 250, default: 100 },
      },
      ItemSort: {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['manual', 'title', 'code', 'created_at', 'updated_at'],
          default: 'manual',
        },
      },
      SortDirection: {
        name: 'direction',
        in: 'query',
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      },
      Search: { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } },
      Filters: {
        name: 'filters',
        in: 'query',
        description: 'A URL-encoded JSON array of typed field filters. At most 20 filters.',
        schema: { type: 'string' },
      },
    },
    responses: {
      BadRequest: problemResponse('Invalid request.'),
      Unauthorized: problemResponse(
        'Missing, invalid, revoked, expired, or wrong-audience credential.',
      ),
      Forbidden: problemResponse('The credential lacks the required permission.'),
      NotFound: problemResponse('The resource does not exist within the credential project.'),
      Conflict: problemResponse(
        'The resource version is stale or a domain invariant would be violated.',
      ),
      TooManyRequests: problemResponse('Request rate limit exceeded.'),
      InternalServerError: problemResponse('Unexpected server error.'),
    },
    schemas: {
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
    },
  },
  'x-coda-contract-generation': {
    requestBodies: 'Generated from packages/contracts Zod schemas.',
    queryParameters:
      'Documented manually and checked against listItemsQuerySchema behavior; OpenAPI cannot express the JSON-encoded filters query directly.',
    responses:
      'Documented stable public fields; response schemas are not generated from runtime serializers.',
  },
};

/**
 * Builds the public, bearer-credential API contract. Request bodies are generated
 * from the same Zod schemas used by controllers. Response schemas describe the
 * stable public fields without claiming to be generated from runtime serializers.
 */
export function buildExternalOpenApiDocument(): JsonObject {
  return structuredClone(externalOpenApiDocument);
}
