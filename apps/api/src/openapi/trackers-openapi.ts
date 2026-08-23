type JsonObject = Record<string, unknown>;

type OperationFactory = (
  operationId: string,
  summary: string,
  tag: string,
  responseSchema: string,
  options?: {
    parameters?: JsonObject[];
    requestSchema?: string;
    successStatus?: '200' | '201';
    description?: string;
    security?: JsonObject[];
    metaSchema?: string;
  },
) => JsonObject;

/**
 * The tracker CRUD paths, split out of `external-openapi.ts` the same way the Spaces paths are:
 * the document factory sits at the file-size budget, and each session-only resource family owns
 * its slice of `paths` beside it.
 */
export function trackersOpenApiPaths(context: {
  operation: OperationFactory;
  sessionReadSecurity: JsonObject[];
  sessionWriteSecurity: JsonObject[];
}): JsonObject {
  const { operation, sessionReadSecurity, sessionWriteSecurity } = context;
  const trackerIdParameter = { $ref: '#/components/parameters/TrackerId' };
  return {
    '/api/v1/trackers': {
      get: operation(
        'listTrackers',
        'List trackers accessible to the signed-in user',
        'Trackers',
        'TrackerList',
        {
          security: sessionReadSecurity,
          parameters: [{ $ref: '#/components/parameters/SpaceIdQuery' }],
        },
      ),
      post: operation('createTracker', 'Create a tracker', 'Trackers', 'Tracker', {
        requestSchema: 'CreateTrackerInput',
        successStatus: '201',
        security: sessionWriteSecurity,
      }),
    },
    '/api/v1/trackers/{trackerId}': {
      get: operation('getTracker', 'Get a tracker', 'Trackers', 'Tracker', {
        parameters: [trackerIdParameter],
        security: sessionReadSecurity,
      }),
      patch: operation('updateTracker', 'Rename or describe a tracker', 'Trackers', 'Tracker', {
        parameters: [trackerIdParameter],
        requestSchema: 'UpdateTrackerInput',
        security: sessionWriteSecurity,
      }),
    },
  };
}
