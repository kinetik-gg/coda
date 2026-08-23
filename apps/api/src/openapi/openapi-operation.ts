type JsonObject = Record<string, unknown>;

/**
 * The shared shape of one OpenAPI operation plus the RFC-9457 error catalogue every path reuses.
 * Split out of `external-openapi.ts` so the document assembly file stays within the line budget
 * while the Spaces and Trackers path factories can compose the exact same operation builder.
 */
export const openApiProblemResponses = {
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

export function jsonBody(schemaName: string): JsonObject {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

export function dataResponse(
  schemaName: string,
  description: string,
  metaSchema?: string,
): JsonObject {
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

export function operation(
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
    // `security` is intentionally omitted when not given: `applyDerivedSecurity`
    // fills it in from the credential allowlist once every path is assembled below,
    // so a project-scoped route can never publish an unreviewed bearer grant.
    ...(options.security ? { security: options.security } : {}),
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.requestSchema ? { requestBody: jsonBody(options.requestSchema) } : {}),
    responses: {
      [successStatus]: dataResponse(
        responseSchema,
        options.description ?? (successStatus === '201' ? 'Created.' : 'Successful response.'),
        options.metaSchema,
      ),
      ...openApiProblemResponses,
    },
  };
}

export function problemResponse(description: string): JsonObject {
  return {
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  };
}
