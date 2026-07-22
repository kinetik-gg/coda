import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CameraIcon } from '@phosphor-icons/react/dist/csr/Camera';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { FilesIcon } from '@phosphor-icons/react/dist/csr/Files';
import { FilmSlateIcon } from '@phosphor-icons/react/dist/csr/FilmSlate';
import { FilmStripIcon } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { TagSimpleIcon } from '@phosphor-icons/react/dist/csr/TagSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { WorkspacePanel, WorkspacePanelSlot, WorkspacePanelType } from '@coda/contracts';
import { DropdownMenu, DropdownMenuItem } from '../components/DropdownMenu';
import type { Project } from './panels/types';
import styles from './DenseWorkspace.module.css';

function panelOfType(
  current: WorkspacePanel,
  type: WorkspacePanelType,
  project: Project,
): WorkspacePanel {
  if (current.type === type) return current;
  if (type === 'entity_table')
    return {
      id: current.id,
      type,
      configVersion: 1,
      config: {
        entityTypeId: project.entityTypes[0]?.id ?? null,
        search: '',
        sort: 'manual',
        direction: 'asc',
        filters: [],
        hiddenColumns: [],
        visibleCustomFieldIds: [],
        columnWidths: {},
      },
    };
  if (type === 'inspector')
    return { id: current.id, type, configVersion: 1, config: { section: 'details', search: '' } };
  if (type === 'pdf')
    return {
      id: current.id,
      type,
      configVersion: 1,
      config: { sourceDocumentId: project.sourceDocuments[0]?.id ?? null, page: 1, zoom: 1 },
    };
  return { id: current.id, type, configVersion: 1, config: { search: '' } };
}

export function entityTypeIcon(level: number) {
  if (level === 2) return FilmStripIcon;
  if (level === 3) return CameraIcon;
  return FilmSlateIcon;
}

function panelLabel(slot: WorkspacePanelSlot, project: Project): string {
  const panel = slot.panel;
  if (panel.type === 'entity_table') {
    return (
      project.entityTypes.find((entry) => entry.id === panel.config.entityTypeId)?.pluralName ??
      'Items'
    );
  }
  if (panel.type === 'inspector') return 'Inspector';
  if (panel.type === 'pdf') return 'PDF Viewer';
  if (panel.type === 'activity') return 'Activity';
  return 'Trash';
}

function auxiliaryPanelLabel(type: 'inspector' | 'pdf' | 'activity' | 'trash'): string {
  if (type === 'inspector') return 'Inspector';
  if (type === 'pdf') return 'PDF Viewer';
  if (type === 'activity') return 'Activity';
  return 'Trash';
}

function AuxiliaryPanelIcon({ type }: { type: 'inspector' | 'pdf' | 'activity' | 'trash' }) {
  if (type === 'inspector') return <TagSimpleIcon size={12} aria-hidden="true" />;
  if (type === 'pdf') return <FilesIcon size={12} aria-hidden="true" />;
  if (type === 'activity') return <ClockCounterClockwiseIcon size={12} aria-hidden="true" />;
  return <TrashIcon size={12} aria-hidden="true" />;
}

export function PanelSelector({
  slot,
  project,
  icon,
  onChange,
}: {
  slot: WorkspacePanelSlot;
  project: Project;
  icon: ReactNode;
  onChange: (panel: WorkspacePanel) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (rootRef.current?.contains(target as Node)) return;
      if (target instanceof Element && target.closest(`[data-dropdown-menu="panel-${slot.id}"]`))
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, slot.id]);

  const currentEntityTypeId =
    slot.panel.type === 'entity_table' ? slot.panel.config.entityTypeId : null;
  const label = panelLabel(slot, project);

  return (
    <div ref={rootRef} className={styles.panelSelector}>
      <DropdownMenu
        portal
        id={`panel-${slot.id}`}
        ariaLabel={label}
        label={
          <>
            <span className={styles.panelPickerIcon}>{icon}</span>
            <span className={styles.panelPickerLabel}>{label}</span>
            <CaretUpDownIcon className={styles.panelPickerCaret} size={12} aria-hidden="true" />
          </>
        }
        open={open}
        triggerClassName={styles.editorPicker}
        popupClassName={styles.panelSelectorPopup}
        onToggle={() => setOpen((value) => !value)}
      >
        {project.entityTypes.map((entityType) => {
          const EntityTypeIcon = entityTypeIcon(entityType.level);
          return (
            <DropdownMenuItem
              key={entityType.id}
              dismiss={() => setOpen(false)}
              ariaCurrent={currentEntityTypeId === entityType.id}
              onSelect={() => {
                const next = panelOfType(slot.panel, 'entity_table', project);
                onChange(
                  next.type === 'entity_table'
                    ? { ...next, config: { ...next.config, entityTypeId: entityType.id } }
                    : next,
                );
              }}
            >
              <span className={styles.panelPickerOption}>
                <span className={styles.panelPickerOptionIcon}>
                  <EntityTypeIcon size={12} aria-hidden="true" />
                </span>
                <span>{entityType.pluralName}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
        {(['inspector', 'pdf', 'activity', 'trash'] as const).map((type) => (
          <DropdownMenuItem
            key={type}
            dismiss={() => setOpen(false)}
            ariaCurrent={slot.panel.type === type}
            onSelect={() => onChange(panelOfType(slot.panel, type, project))}
          >
            <span className={styles.panelPickerOption}>
              <span className={styles.panelPickerOptionIcon}>
                <AuxiliaryPanelIcon type={type} />
              </span>
              <span>{auxiliaryPanelLabel(type)}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
