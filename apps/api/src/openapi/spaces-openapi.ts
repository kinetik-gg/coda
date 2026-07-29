type JsonObject = Record<string, unknown>;

interface OpenApiOperationOptions {
  parameters?: JsonObject[];
  requestSchema?: string;
  successStatus?: '200' | '201';
  security?: JsonObject[];
}

type OpenApiOperation = (
  operationId: string,
  summary: string,
  tag: string,
  responseSchema: string,
  options?: OpenApiOperationOptions,
) => JsonObject;

interface SpacesOpenApiOptions {
  operation: OpenApiOperation;
  sessionReadSecurity: JsonObject[];
  sessionWriteSecurity: JsonObject[];
}

export function spacesOpenApiPaths({
  operation,
  sessionReadSecurity,
  sessionWriteSecurity,
}: SpacesOpenApiOptions): JsonObject {
  const spaceIdParameter = { $ref: '#/components/parameters/SpaceId' };
  return {
    '/api/v1/projects': {
      get: operation(
        'listProjects',
        'List accessible breakdown projects',
        'Project',
        'ProjectList',
        {
          security: sessionReadSecurity,
          parameters: [{ $ref: '#/components/parameters/SpaceIdQuery' }],
        },
      ),
    },
    '/api/v1/spaces': {
      get: operation('listSpaces', 'List accessible Spaces', 'Spaces', 'SpaceList', {
        security: sessionReadSecurity,
      }),
      post: operation('createSpace', 'Create a Space', 'Spaces', 'Space', {
        requestSchema: 'CreateSpaceInput',
        successStatus: '201',
        security: sessionWriteSecurity,
      }),
    },
    '/api/v1/spaces/{spaceId}': {
      get: operation('getSpace', 'Get a Space', 'Spaces', 'Space', {
        parameters: [spaceIdParameter],
        security: sessionReadSecurity,
      }),
      patch: operation('updateSpace', 'Update a Space', 'Spaces', 'Space', {
        parameters: [spaceIdParameter],
        requestSchema: 'UpdateSpaceInput',
        security: sessionWriteSecurity,
      }),
      delete: operation(
        'deleteSpace',
        'Delete an empty non-default Space',
        'Spaces',
        'SpaceRemovalResult',
        {
          parameters: [spaceIdParameter],
          security: sessionWriteSecurity,
        },
      ),
    },
  };
}
