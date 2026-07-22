import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatCircleIcon } from '@phosphor-icons/react/dist/csr/ChatCircle';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import type { WorkspacePanel } from '@coda/contracts';
import { api } from '../../api';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { Tooltip } from '../../components/Tooltip';
import type {
  BreakdownItem,
  EntityType,
  FieldDefinition,
  FieldValue,
  PanelContentProps,
} from './types';
import {
  apiToFieldValue,
  displayFieldValue,
  valueToApi,
  type ApiFieldValue,
} from './item-panel-utils';
import {
  customEditorValue,
  editorKindForField,
  inputForCustom,
  type InspectorEditorValue as EditorValue,
} from './inspector-values';
import { InlineValue } from './InspectorInlineValue';
import styles from './Panels.module.css';

type Inspector = Extract<WorkspacePanel, { type: 'inspector' }>;
interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { displayName: string };
}
interface Activity {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  createdAt: string;
}

function InspectorPropertySkeleton() {
  return (
    <SkeletonGroup label="Loading entity details" className={styles.inspectorSkeleton}>
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index}>
          <Skeleton width={index % 3 === 0 ? 58 : 76} height={8} />
          <Skeleton width={index === 0 ? '72%' : index % 3 === 1 ? '46%' : '88%'} height={10} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function InspectorHeaderControls({
  panel,
  onPanelChange,
}: Pick<PanelContentProps, 'onPanelChange'> & { panel: Inspector }) {
  const [search, setSearch] = useState(panel.config.search);
  const [searchOpen, setSearchOpen] = useState(Boolean(panel.config.search));
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSearch(panel.config.search), [panel.config.search]);
  useEffect(() => {
    if (search === panel.config.search) return;
    const timer = window.setTimeout(
      () => onPanelChange({ ...panel, config: { ...panel.config, search } }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [onPanelChange, panel, search]);

  if (panel.config.section !== 'details') return null;
  return (
    <div className={styles.tableHeaderTools}>
      {searchOpen ? (
        <label className={styles.headerSearchField}>
          <MagnifyingGlassIcon size={12} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if (!search) setSearchOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setSearch('');
              setSearchOpen(false);
            }}
            placeholder="Search"
            aria-label="Search Inspector keys and values"
          />
        </label>
      ) : (
        <Tooltip content="Search Inspector property names and displayed values">
          <button
            type="button"
            className={styles.headerIconButton}
            aria-label="Search Inspector keys and values"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            <MagnifyingGlassIcon size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export { InlineValue } from './InspectorInlineValue';

function CustomFieldRow({
  field,
  value,
  onSave,
}: {
  field: FieldDefinition;
  value?: FieldValue;
  onSave: (draft: EditorValue) => Promise<void>;
}) {
  const type = field.type.toLowerCase();
  if (['file', 'image', 'video'].includes(type)) {
    return (
      <div>
        <dt>{field.name.toUpperCase()}</dt>
        <dd className={styles.readOnlyValue}>
          {displayFieldValue(value) || 'Manage this asset from its source panel.'}
        </dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{field.name.toUpperCase()}</dt>
      <dd>
        <InlineValue
          kind={editorKindForField(type)}
          value={customEditorValue(field, value)}
          display={displayFieldValue(value) || '—'}
          options={field.options}
          onSave={onSave}
        />
      </dd>
    </div>
  );
}

function InspectorReferences({ item }: { item: BreakdownItem }) {
  return (
    <div className={styles.referenceList}>
      {!item.sourceReferences.length && <p className={styles.empty}>No source references.</p>}
      {item.sourceReferences.map((reference, index) => (
        <div key={reference.id ?? index}>
          <span>REFERENCE {String(index + 1).padStart(2, '0')}</span>
          <strong>
            Pages {reference.startPage}–{reference.endPage}
          </strong>
        </div>
      ))}
    </div>
  );
}

function InspectorComments({
  data,
  error,
  isLoading,
  isPosting,
  body,
  onBodyChange,
  onPost,
  onRetry,
}: {
  data?: Comment[];
  error: Error | null;
  isLoading: boolean;
  isPosting: boolean;
  body: string;
  onBodyChange: (body: string) => void;
  onPost: () => void;
  onRetry: () => void;
}) {
  return (
    <div className={styles.comments}>
      {isLoading && (
        <SkeletonGroup label="Loading comments" className={styles.listSkeleton}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index}>
              <Skeleton width="38%" height={8} />
              <Skeleton width={index % 2 ? '78%' : '92%'} height={10} />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {!isLoading && error && (
        <div className={styles.panelQueryState} role="alert">
          <span>Comments could not be loaded.</span>
          <button type="button" className={styles.queryStateAction} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!isLoading &&
        !error &&
        data?.map((comment) => (
          <article key={comment.id}>
            <header>
              {comment.author.displayName}
              <time>{new Date(comment.createdAt).toLocaleString()}</time>
            </header>
            <p>{comment.body}</p>
          </article>
        ))}
      {!isLoading && !error && !data?.length && <p className={styles.empty}>No comments.</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onPost();
        }}
      >
        <ChatCircleIcon size={12} />
        <input
          placeholder="Add a comment"
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <button aria-label="Post comment" disabled={isPosting}>
          <PaperPlaneTiltIcon size={12} />
        </button>
      </form>
    </div>
  );
}

function InspectorActivity({
  data,
  error,
  isLoading,
  itemId,
  onRetry,
}: {
  data?: Activity[];
  error: Error | null;
  isLoading: boolean;
  itemId: string;
  onRetry: () => void;
}) {
  const visible = data?.filter((entry) => !entry.resourceId || entry.resourceId === itemId);
  return (
    <div className={styles.activity}>
      {isLoading && (
        <SkeletonGroup label="Loading item activity" className={styles.listSkeleton}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index}>
              <Skeleton width={index % 2 ? '62%' : '78%'} height={9} />
              <Skeleton width={108} height={8} />
            </div>
          ))}
        </SkeletonGroup>
      )}
      {!isLoading && error && (
        <div className={styles.panelQueryState} role="alert">
          <span>Activity could not be loaded.</span>
          <button type="button" className={styles.queryStateAction} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {!isLoading &&
        !error &&
        visible?.map((entry) => (
          <article key={entry.id}>
            <span>
              {entry.action} {entry.resourceType}
            </span>
            <time>{new Date(entry.createdAt).toLocaleString()}</time>
          </article>
        ))}
      {!isLoading && !error && !visible?.length && (
        <p className={styles.empty}>No activity for this item.</p>
      )}
    </div>
  );
}

export function inspectorMatchesSearch(query: string, key: string, value: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${key} ${value}`.toLocaleLowerCase().includes(normalized);
}

function InspectorDetails({
  item,
  fields,
  parentType,
  parents,
  search,
  isLoading,
  error,
  onRetry,
  onSaveCore,
  onSaveCustom,
}: {
  item: BreakdownItem;
  fields: FieldDefinition[];
  parentType?: EntityType;
  parents: BreakdownItem[];
  search: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSaveCore: (
    key: 'title' | 'displayCode' | 'description' | 'parentId',
    value: EditorValue,
  ) => Promise<void>;
  onSaveCustom: (field: FieldDefinition, value: ApiFieldValue | null) => Promise<void>;
}) {
  if (isLoading) return <InspectorPropertySkeleton />;
  if (error)
    return (
      <div className={styles.panelQueryState} role="alert">
        <span>Entity details could not be loaded.</span>
        <button type="button" className={styles.queryStateAction} onClick={onRetry}>
          Retry
        </button>
      </div>
    );

  const parentOptions = parents.map((parent) => ({
    id: parent.id,
    label: `${parent.displayCode ? `${parent.displayCode} — ` : ''}${parent.title}`,
  }));
  const parentValue =
    parentOptions.find((option) => option.id === item.parentId)?.label ?? item.parentId ?? '';
  const rowIsVisible = (key: string, value: string) => inspectorMatchesSearch(search, key, value);
  const searchableDetails: Array<readonly [string, string]> = [
    ['TITLE', item.title],
    ['CODE', item.displayCode ?? ''],
    ['DESCRIPTION', item.description ?? ''],
  ];
  if (parentType) searchableDetails.push([parentType.singularName, parentValue]);
  for (const field of fields)
    searchableDetails.push([
      field.name,
      displayFieldValue(item.values.find((entry) => entry.fieldId === field.id)),
    ]);
  const hasVisibleDetails = searchableDetails.some(([key, value]) => rowIsVisible(key, value));

  return (
    <dl className={styles.propertyList}>
      {!hasVisibleDetails && (
        <div className={styles.noInspectorResults}>
          <dd>No matching properties.</dd>
        </div>
      )}
      {rowIsVisible('TITLE', item.title) && (
        <div>
          <dt>TITLE</dt>
          <dd>
            <InlineValue value={item.title} onSave={(value) => onSaveCore('title', value)} />
          </dd>
        </div>
      )}
      {rowIsVisible('CODE', item.displayCode ?? '') && (
        <div>
          <dt>CODE</dt>
          <dd>
            <InlineValue
              value={item.displayCode ?? ''}
              display={<span className={styles.mono}>{item.displayCode || '—'}</span>}
              onSave={(value) => onSaveCore('displayCode', value)}
            />
          </dd>
        </div>
      )}
      {parentType && rowIsVisible(parentType.singularName, parentValue) && (
        <div>
          <dt>{parentType.singularName.toUpperCase()}</dt>
          <dd>
            <InlineValue
              kind="enum"
              value={item.parentId ?? ''}
              options={parentOptions}
              onSave={(value) => onSaveCore('parentId', value)}
            />
          </dd>
        </div>
      )}
      {rowIsVisible('DESCRIPTION', item.description ?? '') && (
        <div>
          <dt>DESCRIPTION</dt>
          <dd>
            <InlineValue
              kind="multiline"
              value={item.description ?? ''}
              onSave={(value) => onSaveCore('description', value)}
            />
          </dd>
        </div>
      )}
      {fields.map((field) => {
        const value = item.values.find((entry) => entry.fieldId === field.id);
        if (!rowIsVisible(field.name, displayFieldValue(value))) return null;
        return (
          <CustomFieldRow
            key={field.id}
            field={field}
            value={value}
            onSave={(draft) => onSaveCustom(field, inputForCustom(field, draft))}
          />
        );
      })}
    </dl>
  );
}

export function InspectorPanel({
  project,
  projectId,
  panel,
  activeEntity,
  onSelectEntity,
  onItemOperation,
}: PanelContentProps & { panel: Inspector }) {
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const itemRef = useRef(activeEntity?.item);
  useEffect(() => {
    itemRef.current = activeEntity?.item;
  }, [activeEntity?.item]);
  const fields = useQuery({
    queryKey: ['fields', projectId, activeEntity?.entityType.id],
    queryFn: ({ signal }) =>
      api<FieldDefinition[]>(
        `/api/v1/projects/${projectId}/entity-types/${activeEntity!.entityType.id}/fields`,
        { signal },
      ),
    enabled: Boolean(activeEntity),
  });
  const parentType = activeEntity
    ? project.entityTypes.find((entry) => entry.level === activeEntity.entityType.level - 1)
    : undefined;
  const parents = useQuery({
    queryKey: ['items', projectId, parentType?.id, 'inspector-parents'],
    queryFn: ({ signal }) =>
      api<BreakdownItem[]>(
        `/api/v1/projects/${projectId}/items?entityTypeId=${parentType!.id}&limit=250&sort=manual&direction=asc`,
        { signal },
      ),
    enabled: Boolean(activeEntity && parentType && panel.config.section === 'details'),
  });
  const comments = useQuery({
    queryKey: ['comments', projectId, activeEntity?.item.id],
    queryFn: ({ signal }) =>
      api<Comment[]>(`/api/v1/projects/${projectId}/items/${activeEntity!.item.id}/comments`, {
        signal,
      }),
    enabled: Boolean(activeEntity && panel.config.section === 'comments'),
  });
  const activity = useQuery({
    queryKey: ['activity', projectId],
    queryFn: ({ signal }) => api<Activity[]>(`/api/v1/projects/${projectId}/activity`, { signal }),
    enabled: panel.config.section === 'activity',
  });
  const postComment = useMutation({
    mutationFn: (body: string) =>
      api(`/api/v1/projects/${projectId}/items/${activeEntity!.item.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setCommentBody('');
      void queryClient.invalidateQueries({
        queryKey: ['comments', projectId, activeEntity?.item.id],
      });
    },
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['items', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const emit = (item: BreakdownItem) => {
    itemRef.current = item;
    if (activeEntity) onSelectEntity({ entityType: activeEntity.entityType, item });
  };
  const patchCore = async (
    patch: Partial<Pick<BreakdownItem, 'title' | 'displayCode' | 'description' | 'parentId'>>,
  ) => {
    const current = itemRef.current;
    if (!current) throw new Error('The selected item is no longer available.');
    const updated = await api<BreakdownItem>(`/api/v1/projects/${projectId}/items/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, version: current.version }),
    });
    const next = {
      ...current,
      ...updated,
      values: current.values,
      sourceReferences: current.sourceReferences,
    };
    emit(next);
    await invalidate();
  };
  const saveCore = async (
    key: 'title' | 'displayCode' | 'description' | 'parentId',
    raw: EditorValue,
  ) => {
    const current = itemRef.current!;
    const before = current[key] ?? null;
    const after: string | null = Array.isArray(raw) ? null : raw.trim() || null;
    if (key === 'title' && !after) throw new Error('Title is required.');
    if (before === after) return;
    await patchCore({ [key]: after });
    onItemOperation?.({
      label: `Edit ${key}`,
      undo: () => patchCore({ [key]: before }),
      redo: () => patchCore({ [key]: after }),
    });
  };
  const putCustom = async (field: FieldDefinition, input: ApiFieldValue | null) => {
    const current = itemRef.current;
    if (!current) throw new Error('The selected item is no longer available.');
    const updated = await api<BreakdownItem>(
      `/api/v1/projects/${projectId}/items/${current.id}/fields/${field.id}`,
      { method: 'PUT', body: JSON.stringify({ value: input, itemVersion: current.version }) },
    );
    const previous = current.values.find((entry) => entry.fieldId === field.id);
    const nextValue = apiToFieldValue(field, input, previous);
    emit({
      ...current,
      ...updated,
      values: [
        ...current.values.filter((entry) => entry.fieldId !== field.id),
        ...(nextValue ? [nextValue] : []),
      ],
      sourceReferences: current.sourceReferences,
    });
    await invalidate();
  };
  const saveCustom = async (field: FieldDefinition, after: ApiFieldValue | null) => {
    const before = valueToApi(
      field,
      itemRef.current?.values.find((entry) => entry.fieldId === field.id),
    );
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (field.required && after === null) throw new Error(`${field.name} is required.`);
    await putCustom(field, after);
    onItemOperation?.({
      label: `Edit ${field.name}`,
      undo: () => putCustom(field, before),
      redo: () => putCustom(field, after),
    });
  };

  if (!activeEntity)
    return (
      <div className={styles.inspectorEmpty}>
        <span>INSPECTOR</span>
        <p>Select an entity at any hierarchy level to inspect it here.</p>
      </div>
    );
  const { item } = activeEntity;
  const liveItem = itemRef.current?.id === item.id ? itemRef.current : item;
  const detailFields = fields.data ?? [];
  const detailsLoading = fields.isLoading || Boolean(parentType && parents.isLoading);
  const detailsError = fields.error ?? parents.error;
  const sectionLoading =
    panel.config.section === 'details'
      ? detailsLoading
      : panel.config.section === 'comments'
        ? comments.isLoading
        : panel.config.section === 'activity'
          ? activity.isLoading
          : false;
  return (
    <div className={styles.inspector} aria-busy={sectionLoading}>
      <div className={styles.inspectorScroll}>
        {panel.config.section === 'details' && (
          <InspectorDetails
            item={liveItem}
            fields={detailFields}
            parentType={parentType}
            parents={parents.data ?? []}
            search={panel.config.search}
            isLoading={detailsLoading}
            error={detailsError}
            onRetry={() => {
              void fields.refetch();
              void parents.refetch();
            }}
            onSaveCore={saveCore}
            onSaveCustom={saveCustom}
          />
        )}
        {panel.config.section === 'references' && <InspectorReferences item={liveItem} />}
        {panel.config.section === 'comments' && (
          <InspectorComments
            data={comments.data}
            error={comments.error}
            isLoading={comments.isLoading}
            isPosting={postComment.isPending}
            body={commentBody}
            onBodyChange={setCommentBody}
            onPost={() => {
              if (commentBody.trim()) postComment.mutate(commentBody.trim());
            }}
            onRetry={() => void comments.refetch()}
          />
        )}
        {panel.config.section === 'activity' && (
          <InspectorActivity
            data={activity.data}
            error={activity.error}
            isLoading={activity.isLoading}
            itemId={liveItem.id}
            onRetry={() => void activity.refetch()}
          />
        )}
      </div>
    </div>
  );
}
