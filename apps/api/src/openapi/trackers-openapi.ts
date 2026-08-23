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

const recordSortParameter = {
  name: 'sort',
  in: 'query',
  schema: {
    type: 'string',
    enum: ['manual', 'title', 'created_at', 'updated_at'],
    default: 'manual',
  },
};

/**
 * The tracker paths — CRUD core plus the fields/records surface — split out of
 * `external-openapi.ts` the same way the Spaces paths are. Everything here is session-only:
 * tracker routes reject project-scoped bearer credentials.
 */
export function trackersOpenApiPaths(context: {
  operation: OperationFactory;
  sessionReadSecurity: JsonObject[];
  sessionWriteSecurity: JsonObject[];
}): JsonObject {
  const { operation, sessionReadSecurity, sessionWriteSecurity } = context;
  const trackerIdParameter = { $ref: '#/components/parameters/TrackerId' };
  const fieldIdParameter = { $ref: '#/components/parameters/FieldId' };
  const optionIdParameter = { $ref: '#/components/parameters/OptionId' };
  const read = sessionReadSecurity;
  const write = sessionWriteSecurity;
  return {
    '/api/v1/trackers': {
      get: operation(
        'listTrackers',
        'List trackers accessible to the signed-in user',
        'Trackers',
        'TrackerList',
        {
          security: read,
          parameters: [{ $ref: '#/components/parameters/SpaceIdQuery' }],
        },
      ),
      post: operation('createTracker', 'Create a tracker', 'Trackers', 'Tracker', {
        requestSchema: 'CreateTrackerInput',
        successStatus: '201',
        security: write,
      }),
    },
    '/api/v1/trackers/{trackerId}': {
      get: operation('getTracker', 'Get a tracker', 'Trackers', 'Tracker', {
        parameters: [trackerIdParameter],
        security: read,
      }),
      patch: operation('updateTracker', 'Rename or describe a tracker', 'Trackers', 'Tracker', {
        parameters: [trackerIdParameter],
        requestSchema: 'UpdateTrackerInput',
        security: write,
      }),
    },
    '/api/v1/trackers/{trackerId}/fields': {
      get: operation(
        'listTrackerFields',
        'List tracker fields in manual order',
        'Trackers',
        'TrackerFieldList',
        {
          parameters: [trackerIdParameter],
          security: read,
        },
      ),
      post: operation('createTrackerField', 'Create a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter],
        requestSchema: 'CreateTrackerFieldInput',
        successStatus: '201',
        security: write,
      }),
    },
    '/api/v1/trackers/{trackerId}/fields/{fieldId}': {
      get: operation('getTrackerField', 'Get a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter, fieldIdParameter],
        security: read,
      }),
      patch: operation('updateTrackerField', 'Update a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter, fieldIdParameter],
        requestSchema: 'UpdateTrackerFieldInput',
        security: write,
      }),
      delete: operation(
        'archiveTrackerField',
        'Archive a tracker field into trash',
        'Trackers',
        'ArchiveResult',
        {
          parameters: [trackerIdParameter, fieldIdParameter],
          requestSchema: 'ArchiveTrackerFieldInput',
          description:
            'Soft-deletes the field with an optimistic version guard; its key stays reserved.',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/fields/{fieldId}/reorder': {
      patch: operation(
        'reorderTrackerField',
        'Move a tracker field between siblings',
        'Trackers',
        'TrackerField',
        {
          parameters: [trackerIdParameter, fieldIdParameter],
          requestSchema: 'ReorderTrackerFieldInput',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/fields/{fieldId}/options': {
      post: operation(
        'createTrackerFieldOption',
        'Add an option to an enum or multi-enum field',
        'Trackers',
        'TrackerFieldOption',
        {
          parameters: [trackerIdParameter, fieldIdParameter],
          requestSchema: 'CreateTrackerFieldOptionInput',
          successStatus: '201',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/fields/{fieldId}/options/{optionId}': {
      patch: operation(
        'updateTrackerFieldOption',
        'Rename or recolor an archived-or-active option',
        'Trackers',
        'TrackerFieldOption',
        {
          parameters: [trackerIdParameter, fieldIdParameter, optionIdParameter],
          requestSchema: 'UpdateTrackerFieldOptionInput',
          security: write,
        },
      ),
      delete: operation(
        'archiveTrackerFieldOption',
        'Archive an option (existing values are kept)',
        'Trackers',
        'ArchiveResult',
        {
          parameters: [trackerIdParameter, fieldIdParameter, optionIdParameter],
          security: write,
        },
      ),
    },
    ...trackerRecordsOpenApiPaths(context),
  };
}

/**
 * The tracker record-grid paths, split off {@link trackersOpenApiPaths} to keep both
 * functions inside the function-length budget.
 */
function trackerRecordsOpenApiPaths(context: {
  operation: OperationFactory;
  sessionReadSecurity: JsonObject[];
  sessionWriteSecurity: JsonObject[];
}): JsonObject {
  const { operation, sessionReadSecurity: read, sessionWriteSecurity: write } = context;
  const trackerIdParameter = { $ref: '#/components/parameters/TrackerId' };
  const fieldIdParameter = { $ref: '#/components/parameters/FieldId' };
  const recordIdParameter = { $ref: '#/components/parameters/RecordId' };
  return {
    '/api/v1/trackers/{trackerId}/records': {
      get: {
        ...operation(
          'listTrackerRecords',
          'List tracker records',
          'Trackers',
          'TrackerRecordList',
          {
            parameters: [
              trackerIdParameter,
              { $ref: '#/components/parameters/Cursor' },
              { $ref: '#/components/parameters/Limit' },
              recordSortParameter,
              { $ref: '#/components/parameters/SortDirection' },
              { $ref: '#/components/parameters/Search' },
              { $ref: '#/components/parameters/Filters' },
            ],
            metaSchema: 'ScreenplayPageMeta',
            security: read,
          },
        ),
        'x-coda-zod-contract': 'listTrackerRecordsQuerySchema',
      },
      post: operation(
        'createTrackerRecord',
        'Create a tracker record',
        'Trackers',
        'TrackerRecord',
        {
          parameters: [trackerIdParameter],
          requestSchema: 'CreateTrackerRecordInput',
          successStatus: '201',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/bulk-set': {
      post: operation(
        'bulkSetTrackerRecordValues',
        'Set many record cells at once',
        'Trackers',
        'BulkSetTrackerRecordValuesResult',
        {
          parameters: [trackerIdParameter],
          requestSchema: 'BulkSetTrackerRecordValuesInput',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/bulk-delete': {
      post: operation(
        'bulkDeleteTrackerRecords',
        'Move records to trash in bulk',
        'Trackers',
        'BulkDeleteTrackerRecordsResult',
        {
          parameters: [trackerIdParameter],
          requestSchema: 'BulkDeleteTrackerRecordsInput',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/{recordId}': {
      get: operation(
        'getTrackerRecord',
        'Get a tracker record with its values',
        'Trackers',
        'TrackerRecord',
        {
          parameters: [trackerIdParameter, recordIdParameter],
          security: read,
        },
      ),
      patch: operation(
        'updateTrackerRecord',
        'Rename or move a tracker record',
        'Trackers',
        'TrackerRecord',
        {
          parameters: [trackerIdParameter, recordIdParameter],
          requestSchema: 'UpdateTrackerRecordInput',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/{recordId}/reorder': {
      patch: operation(
        'reorderTrackerRecord',
        'Move a record between siblings in manual order',
        'Trackers',
        'TrackerRecord',
        {
          parameters: [trackerIdParameter, recordIdParameter],
          requestSchema: 'ReorderTrackerRecordInput',
          security: write,
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/{recordId}/fields/{fieldId}': {
      put: operation(
        'setTrackerRecordFieldValue',
        'Set or clear one typed cell of a record',
        'Trackers',
        'TrackerRecord',
        {
          parameters: [trackerIdParameter, recordIdParameter, fieldIdParameter],
          requestSchema: 'SetTrackerRecordFieldValueInput',
          security: write,
        },
      ),
    },
  };
}
