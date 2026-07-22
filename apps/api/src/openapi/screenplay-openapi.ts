type JsonObject = Record<string, unknown>;

export function fountainDownloadOperation(options: {
  operationId: string;
  summary: string;
  description: string;
  sourceDescription: string;
  filenameDescription: string;
  parameters: JsonObject[];
  security: JsonObject[];
  problemResponses: JsonObject;
}): JsonObject {
  return {
    operationId: options.operationId,
    summary: options.summary,
    tags: ['Screenplays'],
    security: options.security,
    parameters: options.parameters,
    responses: {
      '200': {
        description: options.description,
        headers: {
          'Content-Disposition': {
            description: options.filenameDescription,
            schema: { type: 'string' },
          },
        },
        content: {
          'text/plain': { schema: { type: 'string', description: options.sourceDescription } },
        },
      },
      ...options.problemResponses,
    },
  };
}
