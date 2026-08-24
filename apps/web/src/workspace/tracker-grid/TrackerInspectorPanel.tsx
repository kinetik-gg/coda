import { useQuery } from '@tanstack/react-query';
import { listTrackerActivity, listTrackerFields } from '../../api';
import type { WorkspacePanel } from '@coda/contracts';
import type {
  TrackerCurrentUser,
  TrackerField,
  TrackerFieldValue,
  TrackerRecord,
} from '../../trackers/types';
import { displayFieldValue } from '../panels/item-panel-utils';
import {
  customEditorValue,
  editorKindForField,
  inputForCustom,
  type InspectorEditorValue as EditorValue,
} from '../panels/inspector-values';
import { InlineValue } from '../panels/InspectorInlineValue';
import { InspectorActivity, InspectorPropertySkeleton } from '../panels/InspectorSections';
import { useTrackerRecordOperations } from '../panels/use-tracker-record-operations';
import { TrackerInspectorComments } from './TrackerInspectorComments';
import styles from '../panels/Panels.styles';

function isMediaField(field: TrackerField): boolean {
  return ['file', 'image', 'video'].includes(field.type.toLowerCase());
}

function FieldRow({
  field,
  value,
  onSave,
}: {
  field: TrackerField;
  value?: TrackerFieldValue;
  onSave: (draft: EditorValue) => Promise<void>;
}) {
  return (
    <div>
      <dt>{field.name.toUpperCase()}</dt>
      <dd>
        <InlineValue
          kind={editorKindForField(field.type)}
          value={customEditorValue(field, value)}
          display={displayFieldValue(value) || '—'}
          options={field.options}
          onSave={onSave}
        />
      </dd>
    </div>
  );
}

/**
 * The tracker workspace's inspector (#379): the selected record's title and typed field values
 * edited through the shared inline editors, an activity section over the tracker feed, and the
 * record's comment thread (#383). Mutations run through the same undo-aware operations the grid
 * uses.
 */
export function TrackerInspectorPanel({
  trackerId,
  panel,
  selectedRecord,
  canEdit,
  currentUser,
  onItemOperation,
}: {
  trackerId: string;
  panel: Extract<WorkspacePanel, { type: 'inspector' }>;
  selectedRecord?: TrackerRecord;
  canEdit: boolean;
  currentUser: TrackerCurrentUser;
  onItemOperation?: (operation: {
    label: string;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => void;
}) {
  const showActivity = panel.config.section === 'activity';
  const showComments = panel.config.section === 'comments';
  const fields = useQuery({
    queryKey: ['tracker-fields', trackerId],
    queryFn: ({ signal }) => listTrackerFields(trackerId, signal),
  });
  const activity = useQuery({
    queryKey: ['tracker-activity', trackerId],
    queryFn: ({ signal }) => listTrackerActivity(trackerId, signal),
    refetchInterval: 30_000,
    enabled: showActivity,
  });

  const invalidate = async () => {
    /* Row updates propagate through the shared record cache; nothing else to refresh here. */
  };
  const operations = useTrackerRecordOperations({
    trackerId,
    canEdit,
    panelSort: 'manual',
    visibleRecords: selectedRecord ? [selectedRecord] : [],
    setOrderedItems: () => undefined,
    invalidate,
    refreshSelected: () => undefined,
    onSelectRecord: () => undefined,
    onItemOperation,
    onRefetch: () => undefined,
  });

  const saveTitle = async (raw: EditorValue) => {
    const record = selectedRecord;
    if (!record) throw new Error('No record is selected.');
    const title = Array.isArray(raw) ? '' : raw.trim();
    await operations.editTitle(record, title);
  };
  const saveField = async (field: TrackerField, draft: EditorValue) => {
    const record = selectedRecord;
    if (!record) throw new Error('No record is selected.');
    await operations.setCell(record, field, inputForCustom(field, draft));
  };

  if (!selectedRecord) {
    return (
      <div className={styles.inspectorEmpty}>
        <span>INSPECTOR</span>
        <p>Select a record in the grid to inspect it here.</p>
      </div>
    );
  }
  const detailFields = fields.data ?? [];
  return (
    <div className={styles.inspector} aria-busy={fields.isLoading}>
      <div className={styles.inspectorScroll}>
        {!showActivity &&
          !showComments &&
          (fields.isLoading ? (
            <InspectorPropertySkeleton />
          ) : (
            <dl className={styles.propertyList}>
              <div>
                <dt>TITLE</dt>
                <dd>
                  <InlineValue value={selectedRecord.title} onSave={saveTitle} />
                </dd>
              </div>
              {detailFields.map((field) =>
                isMediaField(field) ? (
                  <div key={field.id}>
                    <dt>{field.name.toUpperCase()}</dt>
                    <dd className={styles.readOnlyValue}>
                      {displayFieldValue(
                        selectedRecord.values.find((entry) => entry.fieldId === field.id),
                      ) || 'Manage this asset from its source.'}
                    </dd>
                  </div>
                ) : (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={selectedRecord.values.find((entry) => entry.fieldId === field.id)}
                    onSave={(draft) => saveField(field, draft)}
                  />
                ),
              )}
            </dl>
          ))}
        {showActivity && (
          <InspectorActivity
            data={
              activity.data as Array<{
                id: string;
                action: string;
                resourceType: string;
                resourceId?: string | null;
                createdAt: string;
              }>
            }
            error={activity.error ?? null}
            isLoading={activity.isLoading}
            itemId={selectedRecord.id}
            onRetry={() => void activity.refetch()}
          />
        )}
        {showComments && (
          <TrackerInspectorComments
            trackerId={trackerId}
            recordId={selectedRecord.id}
            currentUser={currentUser}
          />
        )}
      </div>
    </div>
  );
}
