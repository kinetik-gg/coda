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
 * `external-openapi.ts` the same way the Spaces paths are. Tracker-scoped credentials may reach
 * exactly the families the project allowlist admits (see `session.guard.ts`): those operations
 * deliberately carry NO explicit `security` so the published requirement derives from the guard's
 * allowlist and cannot drift from it. Everything else stays session-only through an explicit
 * `sessionCookie`(+CSRF) override — collection listing/creation, bulk writes, field options,
 * and comment deletion.
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
      }),
      patch: operation('updateTracker', 'Rename or describe a tracker', 'Trackers', 'Tracker', {
        parameters: [trackerIdParameter],
        requestSchema: 'UpdateTrackerInput',
      }),
    },
    '/api/v1/trackers/{trackerId}/activity': {
      get: operation(
        'listTrackerActivity',
        'List recent tracker activity',
        'Trackers',
        'ActivityList',
        {
          parameters: [trackerIdParameter, { $ref: '#/components/parameters/Cursor' }],
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/fields': {
      get: operation(
        'listTrackerFields',
        'List tracker fields in manual order',
        'Trackers',
        'TrackerFieldList',
        {
          parameters: [trackerIdParameter],
        },
      ),
      post: operation('createTrackerField', 'Create a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter],
        requestSchema: 'CreateTrackerFieldInput',
        successStatus: '201',
      }),
    },
    '/api/v1/trackers/{trackerId}/fields/{fieldId}': {
      get: operation('getTrackerField', 'Get a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter, fieldIdParameter],
      }),
      patch: operation('updateTrackerField', 'Update a tracker field', 'Trackers', 'TrackerField', {
        parameters: [trackerIdParameter, fieldIdParameter],
        requestSchema: 'UpdateTrackerFieldInput',
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
    ...trackerCommentsOpenApiPaths(context),
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
  const { operation, sessionWriteSecurity: write } = context;
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
        },
      ),
    },
  };
}

/**
 * The tracker record-comment paths, split off {@link trackerRecordsOpenApiPaths} to keep both
 * functions inside the function-length budget. Commenting follows the breakdown comment rules:
 * reads need `read_tracker`, writes the comment gate, and edits/deletes stay author-only.
 */
function trackerCommentsOpenApiPaths(context: {
  operation: OperationFactory;
  sessionReadSecurity: JsonObject[];
  sessionWriteSecurity: JsonObject[];
}): JsonObject {
  const { operation, sessionWriteSecurity: write } = context;
  const commentParameters = [
    { $ref: '#/components/parameters/TrackerId' },
    { $ref: '#/components/parameters/RecordId' },
  ];
  return {
    '/api/v1/trackers/{trackerId}/records/{recordId}/comments': {
      get: {
        ...operation(
          'listTrackerComments',
          'List comments on a tracker record, oldest first',
          'Trackers',
          'TrackerCommentList',
          {
            parameters: [
              ...commentParameters,
              { $ref: '#/components/parameters/Cursor' },
              { $ref: '#/components/parameters/Limit' },
            ],
            metaSchema: 'ScreenplayPageMeta',
          },
        ),
        'x-coda-zod-contract': 'listTrackerCommentsQuerySchema',
      },
      post: operation(
        'createTrackerComment',
        'Comment on a tracker record',
        'Trackers',
        'TrackerComment',
        {
          parameters: commentParameters,
          requestSchema: 'CreateTrackerCommentInput',
          successStatus: '201',
          description:
            'Rejected with 404 when the record is missing or already in trash; commenting on a ' +
            'trashed record is never allowed.',
        },
      ),
    },
    '/api/v1/trackers/{trackerId}/records/{recordId}/comments/{commentId}': {
      patch: operation(
        'updateTrackerComment',
        'Edit a comment authored by the signed-in user',
        'Trackers',
        'TrackerComment',
        {
          parameters: [...commentParameters, { $ref: '#/components/parameters/CommentId' }],
          requestSchema: 'UpdateTrackerCommentInput',
        },
      ),
      delete: operation(
        'deleteTrackerComment',
        'Soft-delete a comment authored by the signed-in user',
        'Trackers',
        'TrackerCommentDeleteResult',
        {
          parameters: [...commentParameters, { $ref: '#/components/parameters/CommentId' }],
          security: write,
        },
      ),
    },
  };
}
