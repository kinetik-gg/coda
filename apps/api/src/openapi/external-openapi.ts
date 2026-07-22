import { externalOpenApiSchemas } from './external-openapi-schemas';
import { fountainDownloadOperation } from './screenplay-openapi';

type JsonObject = Record<string, unknown>;

const problemResponses = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '413': problemResponse('Request body exceeds the configured transport limit.'),
  '429': { $ref: '#/components/responses/TooManyRequests' },
  '500': { $ref: '#/components/responses/InternalServerError' },
  '503': problemResponse('Request parsing or a required dependency is temporarily unavailable.'),
  '507': problemResponse('The owner screenplay quota is exhausted.'),
};

const projectIdParameter = { $ref: '#/components/parameters/ProjectId' };
const screenplayIdParameter = { $ref: '#/components/parameters/ScreenplayId' };
const checkpointIdParameter = { $ref: '#/components/parameters/CheckpointId' };
const entityTypeIdParameter = { $ref: '#/components/parameters/EntityTypeId' };
const itemIdParameter = { $ref: '#/components/parameters/ItemId' };
const fieldIdParameter = { $ref: '#/components/parameters/FieldId' };

function jsonBody(schemaName: string): JsonObject {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

function dataResponse(schemaName: string, description: string, metaSchema?: string): JsonObject {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          allOf: [
            { $ref: '#/components/schemas/DataEnvelope' },
            {
              type: 'object',
              properties: {
                data: { $ref: `#/components/schemas/${schemaName}` },
                ...(metaSchema ? { meta: { $ref: `#/components/schemas/${metaSchema}` } } : {}),
              },
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
    security?: JsonObject[];
    metaSchema?: string;
  } = {},
): JsonObject {
  const successStatus = options.successStatus ?? '200';
  return {
    operationId,
    summary,
    tags: [tag],
    security: options.security ?? [{ bearerAuth: [] }],
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.requestSchema ? { requestBody: jsonBody(options.requestSchema) } : {}),
    responses: {
      [successStatus]: dataResponse(
        responseSchema,
        options.description ?? (successStatus === '201' ? 'Created.' : 'Successful response.'),
        options.metaSchema,
      ),
      ...problemResponses,
    },
  };
}

const sessionReadSecurity = [{ sessionCookie: [] }];
const sessionWriteSecurity = [{ sessionCookie: [], csrfCookie: [], csrfHeader: [] }];

function problemResponse(description: string): JsonObject {
  return {
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  };
}

const uuid = { type: 'string', format: 'uuid' };

const externalOpenApiDocument: JsonObject = {
  openapi: '3.1.0',
  info: {
    title: 'Coda External API',
    version: '1.0.0',
    summary: 'API for screenplay authoring and project-scoped source breakdown data.',
    description:
      'Breakdown routes accept project-bound API keys and MCP tokens. Screenplay routes require a signed-in browser session and do not accept project-scoped bearer credentials. Mutating screenplay requests also require the CSRF cookie and matching X-Coda-CSRF header. This document intentionally excludes setup, account, session administration, instance administration, membership, role, invitation, ownership-transfer, workspace-layout, project import, trash, and purge operations.',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: '/', description: 'The Coda instance that issued the credential.' }],
  tags: [
    { name: 'Credential', description: 'Inspect the active project-scoped credential.' },
    { name: 'Project', description: 'Read or update the bound project.' },
    {
      name: 'Screenplays',
      description: 'Create, edit, import, and export owner-authored Fountain screenplays.',
    },
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
    '/api/v1/screenplays': {
      get: operation(
        'listScreenplays',
        'List screenplays owned by the signed-in user',
        'Screenplays',
        'ScreenplaySummaryList',
        {
          security: sessionReadSecurity,
          parameters: [
            { $ref: '#/components/parameters/ScreenplayCursor' },
            { $ref: '#/components/parameters/ScreenplayLimit' },
          ],
          metaSchema: 'ScreenplayPageMeta',
        },
      ),
      post: operation(
        'createScreenplay',
        'Create a Fountain screenplay',
        'Screenplays',
        'Screenplay',
        {
          requestSchema: 'CreateScreenplayInput',
          successStatus: '201',
          security: sessionWriteSecurity,
        },
      ),
    },
    '/api/v1/screenplays/import': {
      post: operation(
        'importScreenplay',
        'Import Fountain source as a screenplay',
        'Screenplays',
        'Screenplay',
        {
          requestSchema: 'ImportScreenplayInput',
          successStatus: '201',
          security: sessionWriteSecurity,
          description:
            'Created from a .fountain, .spmd, or .txt filename. The source text is preserved exactly.',
        },
      ),
    },
    '/api/v1/screenplays/{screenplayId}': {
      get: operation('getScreenplay', 'Get a screenplay', 'Screenplays', 'Screenplay', {
        parameters: [screenplayIdParameter],
        security: sessionReadSecurity,
      }),
      patch: operation('updateScreenplay', 'Update a screenplay', 'Screenplays', 'Screenplay', {
        parameters: [screenplayIdParameter],
        requestSchema: 'UpdateScreenplayInput',
        security: sessionWriteSecurity,
      }),
    },
    '/api/v1/screenplays/{screenplayId}/export.fountain': {
      get: fountainDownloadOperation({
        operationId: 'exportScreenplayFountain',
        summary: 'Download the current canonical Fountain source',
        parameters: [screenplayIdParameter],
        description:
          'Exact current UTF-8 Fountain source. This legacy route does not create an immutable checkpoint.',
        filenameDescription: 'Attachment filename ending in .fountain.',
        sourceDescription: 'Canonical Fountain source text.',
        security: sessionReadSecurity,
        problemResponses,
      }),
    },
    '/api/v1/screenplays/{screenplayId}/checkpoints': {
      post: operation(
        'createScreenplayCheckpoint',
        'Create an immutable export checkpoint',
        'Screenplays',
        'ScreenplayCheckpoint',
        {
          parameters: [screenplayIdParameter],
          requestSchema: 'CreateScreenplayCheckpointInput',
          successStatus: '201',
          security: sessionWriteSecurity,
          description:
            'Snapshots the exact current Fountain source when the supplied version matches. Repeating the screenplay/version pair returns the same checkpoint.',
        },
      ),
    },
    '/api/v1/screenplays/{screenplayId}/checkpoints/{checkpointId}/export.fountain': {
      get: fountainDownloadOperation({
        operationId: 'exportScreenplayCheckpointFountain',
        summary: 'Download an immutable Fountain checkpoint',
        parameters: [screenplayIdParameter, checkpointIdParameter],
        description: 'Exact UTF-8 Fountain source stored by the checkpoint.',
        filenameDescription: 'Snapshotted attachment filename ending in .fountain.',
        sourceDescription: 'Immutable Fountain source text.',
        security: sessionReadSecurity,
        problemResponses,
      }),
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
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'coda_session',
        description:
          'Browser session cookie. Screenplay routes do not accept project-scoped bearer credentials.',
      },
      csrfCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'coda_csrf',
        description: 'CSRF cookie required for mutating session-authenticated requests.',
      },
      csrfHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Coda-CSRF',
        description: 'Must exactly match the coda_csrf cookie.',
      },
    },
    parameters: {
      ProjectId: { name: 'projectId', in: 'path', required: true, schema: uuid },
      ScreenplayId: { name: 'screenplayId', in: 'path', required: true, schema: uuid },
      CheckpointId: { name: 'checkpointId', in: 'path', required: true, schema: uuid },
      ScreenplayCursor: {
        name: 'cursor',
        in: 'query',
        required: false,
        description: 'Opaque cursor returned as meta.nextCursor by the preceding page.',
        schema: { type: 'string', minLength: 1, maxLength: 512 },
      },
      ScreenplayLimit: {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
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
        'Missing or invalid session or bearer credential, including revoked, expired, or wrong-audience bearer credentials.',
      ),
      Forbidden: problemResponse(
        'The credential lacks the required permission, or a session-authenticated mutation failed CSRF validation.',
      ),
      NotFound: problemResponse('The resource does not exist or is not accessible to the caller.'),
      Conflict: problemResponse(
        'The resource version is stale or a domain invariant would be violated.',
      ),
      TooManyRequests: problemResponse('Request rate limit exceeded.'),
      InternalServerError: problemResponse('Unexpected server error.'),
    },
    schemas: externalOpenApiSchemas,
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
