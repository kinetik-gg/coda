import type { WorkspacePanel } from '@coda/contracts';
import type { TrackerField, TrackerFieldOption, TrackerRecord } from '../../trackers/types';
import { freshGridConfig, gridCellText, type TrackerGridColumn } from '../tracker-model';

/** The tracker workspace's kanban panel (`board` in the shared panel-type union). */
export type BoardPanel = Extract<WorkspacePanel, { type: 'board' }>;

/** The nil-UUID sentinel for "no field chosen yet"; real field ids never collide with it. */
export const UNSET_FIELD_ID = '00000000-0000-0000-0000-000000000000';

export const UNASSIGNED_LANE_KEY = 'unassigned';

/** A fresh board panel body; grouping starts unset until a View-menu field is picked. */
export function freshBoardConfig() {
  return { ...freshGridConfig(), groupByFieldId: UNSET_FIELD_ID, cardFieldIds: [] };
}
const LANE_KEY_PREFIX = 'lane:';

/** Lanes are addressed as `lane:<optionId>` (or `lane:<unassigned>`) inside the config. */
export function laneKey(option: TrackerFieldOption | null): string {
  return `${LANE_KEY_PREFIX}${option?.id ?? UNASSIGNED_LANE_KEY}`;
}

function collapsedLanes(config: BoardPanel['config']): Set<string> {
  return new Set(config.hiddenColumns.filter((entry) => entry.startsWith(LANE_KEY_PREFIX)));
}

export interface BoardLane {
  key: string;
  option: TrackerFieldOption | null;
  label: string;
  records: TrackerRecord[];
  collapsed: boolean;
}

/**
 * The board's lanes: one per active option of the single-select group-by field (field order),
 * then an explicit Unassigned lane collecting records whose value is unset or points at an
 * option that no longer exists.
 */
export function boardLanes(
  config: BoardPanel['config'],
  field: TrackerField | undefined,
  records: TrackerRecord[],
): BoardLane[] {
  const collapsed = collapsedLanes(config);
  const lanes: BoardLane[] = field
    ? field.options.map((option) => ({
        key: laneKey(option),
        option,
        label: option.label,
        records: [],
        collapsed: collapsed.has(laneKey(option)),
      }))
    : [];
  const unassigned: BoardLane = {
    key: laneKey(null),
    option: null,
    label: 'Unassigned',
    records: [],
    collapsed: collapsed.has(laneKey(null)),
  };
  if (!field) {
    unassigned.records.push(...records);
    return [unassigned];
  }
  const byOption = new Map(lanes.map((lane) => [lane.option!.id, lane]));
  for (const record of records) {
    const optionId = record.values.find((entry) => entry.fieldId === field.id)?.option?.id;
    (optionId ? byOption.get(optionId) ?? unassigned : unassigned).records.push(record);
  }
  return [...lanes, unassigned];
}

/** The read-only secondary columns a card renders, resolved from `cardFieldIds`. */
export function boardCardColumns(config: BoardPanel['config'], fields: TrackerField[]): TrackerGridColumn[] {
  return config.cardFieldIds.flatMap((id) => {
    const field = fields.find((entry) => entry.id === id);
    return field ? [{ key: `field:${field.id}`, label: field.name, field }] : [];
  });
}

/** One card line: title plus each configured secondary value through the shared cell text. */
export function boardCardText(record: TrackerRecord, column: TrackerGridColumn): string {
  return column.key === 'title' ? record.title : gridCellText(record, column.field?.id ?? '');
}

/** The lane a record currently sits in, or the Unassigned lane when unmapped. */
export function laneOfRecord(lanes: BoardLane[], record: TrackerRecord): BoardLane | undefined {
  return lanes.find((lane) => lane.records.some((entry) => entry.id === record.id));
}
