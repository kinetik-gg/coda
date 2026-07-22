import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCursorPage } from '../../api';
import { ENTITY_PAGE_SIZE, fetchAllCursorItems, withCursor } from './cursor-items';
import { headerMinimumColumnWidth, resizedColumnWidth } from './entity-table-sizing';
import {
  columnIsVisible,
  contextParentId,
  entityTableColumns,
  type EntityPanel,
} from './entity-table-model';
import {
  EntityTableContextMenu,
  EntityTableDialogs,
  EntityTableGrid,
  type EntityTableMenu,
} from './EntityTableView';
import type { BreakdownItem, EntityType, FieldDefinition, PanelContentProps } from './types';
import {
  useEntityTableDeletion,
  useEntityTableEditor,
  useEntityTableReorder,
} from './use-entity-table-operations';
import styles from './Panels.styles';

const COUNT_COLUMN_WIDTH = 48;

export { EntityTableHeaderControls } from './EntityTableHeaderControls';

function EntityTablePanelContent({
  gridProps,
  displayedError,
  onClearError,
  contextMenuProps,
  dialogProps,
}: {
  gridProps: ComponentProps<typeof EntityTableGrid>;
  displayedError?: string;
  onClearError: () => void;
  contextMenuProps: ComponentProps<typeof EntityTableContextMenu>;
  dialogProps: ComponentProps<typeof EntityTableDialogs>;
}) {
  return (
    <div className={styles.panelBody} aria-busy={gridProps.loading}>
      <EntityTableGrid {...gridProps} />
      {displayedError && (
        <button className={styles.inlineError} onClick={onClearError}>
          {displayedError}
        </button>
      )}
      <EntityTableContextMenu {...contextMenuProps} />
      <EntityTableDialogs {...dialogProps} />
    </div>
  );
}

function tableQueryParams(
  typeId: string | undefined,
  parentId: string | undefined,
  panel: EntityPanel,
): string {
  if (!typeId) return '';
  const query = new URLSearchParams({
    entityTypeId: typeId,
    limit: String(ENTITY_PAGE_SIZE),
    sort: panel.config.sort,
    direction: panel.config.direction,
  });
  if (panel.config.search) query.set('search', panel.config.search);
  if (parentId) query.set('parentId', parentId);
  if (panel.config.filters.length) query.set('filters', JSON.stringify(panel.config.filters));
  return query.toString();
}

function selectedEntityType(entityTypes: EntityType[], entityTypeId: string | null) {
  return entityTypes.find((entry) => entry.id === entityTypeId) ?? entityTypes[0];
}

function parentEntityType(type: EntityType | undefined, entityTypes: EntityType[]) {
  if (!type) return undefined;
  return entityTypes.find((entry) => entry.level === type.level - 1);
}

function resolvedTableItems(
  orderedItems: BreakdownItem[] | undefined,
  loadedItems: BreakdownItem[] | undefined,
): BreakdownItem[] {
  return orderedItems ?? loadedItems ?? [];
}

function defaultParentSelection(
  parentId: string | undefined,
  activeEntity: PanelContentProps['activeEntity'],
  parentTypeId: string | undefined,
): string | null | undefined {
  if (parentId) return parentId;
  if (activeEntity && activeEntity.entityType.id === parentTypeId) return activeEntity.item.id;
  return null;
}

function useColumnResize(
  panel: EntityPanel,
  onPanelChange: PanelContentProps['onPanelChange'],
  columnWidths: Record<string, number>,
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
) {
  useEffect(
    () => setColumnWidths(panel.config.columnWidths),
    [panel.config.columnWidths, setColumnWidths],
  );

  return (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const initial =
      columnWidths[key] ?? (key === 'code' ? 94 : key === 'children' ? COUNT_COLUMN_WIDTH : 180);
    const header = event.currentTarget.closest('th');
    const label = header?.querySelector<HTMLElement>('[data-column-label]');
    const headerStyle = header ? window.getComputedStyle(header) : undefined;
    const minimum = Math.max(
      48,
      headerMinimumColumnWidth(
        label?.getBoundingClientRect().width ?? 0,
        Number.parseFloat(headerStyle?.paddingLeft ?? '0'),
        Number.parseFloat(headerStyle?.paddingRight ?? '0'),
      ),
    );
    let next = initial;
    const move = (pointer: PointerEvent) => {
      next = resizedColumnWidth(initial + pointer.clientX - start, minimum);
      setColumnWidths((current) => ({ ...current, [key]: next }));
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      onPanelChange({
        ...panel,
        config: { ...panel.config, columnWidths: { ...panel.config.columnWidths, [key]: next } },
      });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end, { once: true });
  };
}

function useEntityPanelActions({
  panelId,
  items,
  activeItemId,
  parentType,
  parentCount,
  singularName,
  onError,
  onCreate,
  onSelect,
}: {
  panelId: string;
  items: BreakdownItem[];
  activeItemId?: string;
  parentType?: { singularName: string };
  parentCount: number;
  singularName?: string;
  onError: (message: string) => void;
  onCreate: () => void;
  onSelect: (item: BreakdownItem) => void;
}) {
  useEffect(() => {
    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<{ panelId: string; action: string }>).detail;
      if (!detail || detail.panelId !== panelId) return;
      if (detail.action === 'add-item') {
        if (parentType && parentCount === 0) {
          onError(`Add a ${parentType.singularName} before adding a ${singularName ?? 'item'}.`);
          return;
        }
        onCreate();
      }
      if (!items.length) return;
      const currentIndex = items.findIndex((item) => item.id === activeItemId);
      const index =
        detail.action === 'select-first'
          ? 0
          : detail.action === 'select-next'
            ? Math.min(items.length - 1, Math.max(0, currentIndex + 1))
            : detail.action === 'select-previous'
              ? Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1)
              : -1;
      if (index >= 0) onSelect(items[index]!);
    };
    window.addEventListener('coda:panel-action', handleAction);
    return () => window.removeEventListener('coda:panel-action', handleAction);
  }, [
    activeItemId,
    items,
    onCreate,
    onError,
    onSelect,
    panelId,
    parentCount,
    parentType,
    singularName,
  ]);
}

export function EntityTablePanel({
  project,
  projectId,
  panel,
  activeEntity,
  onSelectEntity,
  onItemOperation,
  onPanelChange,
}: PanelContentProps & { panel: EntityPanel }) {
  const queryClient = useQueryClient();
  const type = selectedEntityType(project.entityTypes, panel.config.entityTypeId);
  const parentType = parentEntityType(type, project.entityTypes);
  const [menu, setMenu] = useState<EntityTableMenu>();
  const [orderedItems, setOrderedItems] = useState<BreakdownItem[]>();
  const [operationError, setOperationError] = useState<string>();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    panel.config.columnWidths,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const parentId = type ? contextParentId(type, project.entityTypes, activeEntity) : undefined;
  const orderingScope = `${type?.id ?? 'none'}:${parentId ?? 'root'}`;
  const params = useMemo(
    () => tableQueryParams(type?.id, parentId, panel),
    [panel, parentId, type?.id],
  );
  const fields = useQuery({
    queryKey: ['fields', projectId, type?.id],
    queryFn: ({ signal }) =>
      api<FieldDefinition[]>(`/api/v1/projects/${projectId}/entity-types/${type!.id}/fields`, {
        signal,
      }),
    enabled: Boolean(type),
  });
  const items = useInfiniteQuery({
    queryKey: ['items', projectId, type?.id, params],
    queryFn: ({ signal, pageParam }) =>
      apiCursorPage<BreakdownItem>(
        withCursor(`/api/v1/projects/${projectId}/items?${params}`, pageParam),
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(type),
    staleTime: 5_000,
  });
  const loadedItems = useMemo(() => items.data?.pages.flatMap((page) => page.items), [items.data]);
  const visibleItems = resolvedTableItems(orderedItems, loadedItems);

  useEffect(() => setOrderedItems(undefined), [loadedItems]);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['items', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  }, [projectId, queryClient]);
  const refreshSelected = useCallback(
    (item: BreakdownItem) => {
      if (type) onSelectEntity({ entityType: type, item });
    },
    [onSelectEntity, type],
  );
  const editor = useEntityTableEditor({
    projectId,
    type,
    invalidate,
    refreshSelected,
    onSelectEntity,
    onItemOperation,
  });
  const parents = useQuery({
    queryKey: ['items', projectId, parentType?.id, 'modal-parents'],
    queryFn: ({ signal }) =>
      fetchAllCursorItems<BreakdownItem>(
        `/api/v1/projects/${projectId}/items?entityTypeId=${parentType!.id}&limit=${ENTITY_PAGE_SIZE}&sort=manual&direction=asc`,
        signal,
      ),
    enabled: Boolean(parentType && editor.editor),
  });
  const deletion = useEntityTableDeletion({
    projectId,
    visibleItems,
    invalidate,
    refreshSelected,
    onSelectEntity,
    onItemOperation,
    onDeleted: () => setMenu(undefined),
  });
  const reorder = useEntityTableReorder({
    projectId,
    type,
    panel,
    visibleItems,
    setOrderedItems,
    invalidate,
    refreshSelected,
    onItemOperation,
    onRefetch: () => void items.refetch(),
  });

  useEntityPanelActions({
    panelId: panel.id,
    items: visibleItems,
    activeItemId: activeEntity?.item.id,
    parentType,
    parentCount: parentType?._count?.items ?? parents.data?.length ?? 0,
    singularName: type?.singularName,
    onError: setOperationError,
    onCreate: () => {
      editor.setError(undefined);
      editor.setEditor({ mode: 'create' });
    },
    onSelect: refreshSelected,
  });

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ panelId: string; action: string }>).detail;
      if (detail?.panelId === panel.id && detail.action === 'refresh') void items.refetch();
    };
    window.addEventListener('coda:panel-action', refresh);
    return () => window.removeEventListener('coda:panel-action', refresh);
  }, [items, panel.id]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const startResize = useColumnResize(panel, onPanelChange, columnWidths, setColumnWidths);

  if (!type) return <div className={styles.empty}>This project has no hierarchy levels.</div>;
  const visibleColumns = entityTableColumns(type, project.entityTypes, fields.data ?? []).filter(
    (column) => columnIsVisible(panel, column),
  );
  const tableLoading = items.isLoading || fields.isLoading;
  const tableError = items.error ?? fields.error;
  const defaultParentId = defaultParentSelection(parentId, activeEntity, parentType?.id);
  const displayedError = operationError ?? reorder.error;

  return (
    <EntityTablePanelContent
      gridProps={{
        type,
        isDeepest: type.level === Math.max(...project.entityTypes.map((entry) => entry.level)),
        orderingScope,
        columns: visibleColumns,
        columnWidths,
        items: visibleItems,
        selectedId: activeEntity?.item.id,
        parentId,
        sort: panel.config.sort,
        loading: tableLoading,
        error: tableError,
        hasMore: items.hasNextPage,
        loadingMore: items.isFetchingNextPage,
        onLoadMore: () => void items.fetchNextPage(),
        onResize: startResize,
        onReorder: (event) => void reorder.reorder(event),
        onRetry: () => {
          void items.refetch();
          void fields.refetch();
        },
        onEdit: (item) => {
          editor.setError(undefined);
          editor.setEditor({ mode: 'edit', item });
        },
        onSelect: refreshSelected,
        onOpenMenu: (event, item) => {
          event.preventDefault();
          event.stopPropagation();
          refreshSelected(item);
          setMenu({ x: event.clientX, y: event.clientY, item });
        },
      }}
      displayedError={displayedError}
      onClearError={() => {
        setOperationError(undefined);
        reorder.setError(undefined);
      }}
      contextMenuProps={{
        menu,
        menuRef,
        singularName: type.singularName,
        onAdd: () => {
          editor.setError(undefined);
          editor.setEditor({ mode: 'create' });
          setMenu(undefined);
        },
        onEdit: (item) => {
          editor.setError(undefined);
          editor.setEditor({ mode: 'edit', item });
          setMenu(undefined);
        },
        onDelete: (item) => {
          deletion.setError(undefined);
          deletion.setConfirmation(item);
          setMenu(undefined);
        },
      }}
      dialogProps={{
        type,
        parentType,
        parents: parents.data ?? [],
        defaultParentId,
        editor: editor.editor,
        editorBusy: editor.busy,
        editorError: editor.error,
        deleteConfirmation: deletion.confirmation,
        deleteBusy: deletion.busy,
        deleteError: deletion.error,
        onCloseEditor: () => {
          if (!editor.busy) editor.setEditor(undefined);
        },
        onSaveEditor: (values) => void editor.save(values),
        onCancelDelete: () => {
          deletion.setError(undefined);
          deletion.setConfirmation(undefined);
        },
        onConfirmDelete: (item) => void deletion.trash(item),
      }}
    />
  );
}
