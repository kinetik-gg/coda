import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { api } from '../../api';
import { Tooltip } from '../../components/Tooltip';
import { PanelCommandMenu } from '../PanelCommandMenu';
import {
  columnIsVisible,
  entityTableColumns,
  type EntityPanel,
  type EntityTableColumn,
} from './entity-table-model';
import type { FieldDefinition, PanelContentProps } from './types';
import styles from './Panels.styles';

export function EntityTableHeaderControls({
  project,
  projectId,
  panel,
  onPanelChange,
}: Pick<PanelContentProps, 'project' | 'projectId' | 'onPanelChange'> & { panel: EntityPanel }) {
  const type =
    project.entityTypes.find((entry) => entry.id === panel.config.entityTypeId) ??
    project.entityTypes[0];
  const [search, setSearch] = useState(panel.config.search);
  const [searchOpen, setSearchOpen] = useState(Boolean(panel.config.search));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fields = useQuery({
    queryKey: ['fields', projectId, type?.id],
    queryFn: ({ signal }) =>
      api<FieldDefinition[]>(`/api/v1/projects/${projectId}/entity-types/${type!.id}/fields`, {
        signal,
      }),
    enabled: Boolean(type),
  });

  useEffect(() => setSearch(panel.config.search), [panel.config.search]);
  useEffect(() => {
    if (search === panel.config.search) return;
    const timer = window.setTimeout(
      () => onPanelChange({ ...panel, config: { ...panel.config, search } }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [onPanelChange, panel, search]);

  if (!type) return null;
  const availableColumns = entityTableColumns(type, project.entityTypes, fields.data ?? []);
  const toggleColumn = (column: EntityTableColumn) => {
    if (column.field) {
      const visibleCustomFieldIds = panel.config.visibleCustomFieldIds.includes(column.field.id)
        ? panel.config.visibleCustomFieldIds.filter((entry) => entry !== column.field!.id)
        : [...panel.config.visibleCustomFieldIds, column.field.id];
      onPanelChange({ ...panel, config: { ...panel.config, visibleCustomFieldIds } });
      return;
    }
    const hiddenColumns = panel.config.hiddenColumns.includes(column.key)
      ? panel.config.hiddenColumns.filter((entry) => entry !== column.key)
      : [...panel.config.hiddenColumns, column.key];
    onPanelChange({ ...panel, config: { ...panel.config, hiddenColumns } });
  };

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
            aria-label={`Search ${type.pluralName}`}
          />
        </label>
      ) : (
        <Tooltip content={`Search ${type.pluralName} by visible table values`}>
          <button
            type="button"
            className={styles.headerIconButton}
            aria-label={`Search ${type.pluralName}`}
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            <MagnifyingGlassIcon size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <PanelCommandMenu
        label="Columns"
        triggerContent={<ColumnsIcon size={12} aria-hidden="true" />}
        triggerClassName={styles.headerIconButton}
        popupClassName={styles.columnsPopup}
        items={availableColumns.map((column) => ({
          label: column.label,
          checked: columnIsVisible(panel, column),
          dismissOnSelect: false,
          action: () => toggleColumn(column),
        }))}
      />
    </div>
  );
}
