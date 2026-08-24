import { describe, expect, it } from 'vitest';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import {
  boardCardColumns,
  boardCardText,
  boardLanes,
  freshBoardConfig,
  laneKey,
  laneOfRecord,
  UNASSIGNED_LANE_KEY,
  UNSET_FIELD_ID,
} from './board-model';

function field(id: string, optionIds: string[]): TrackerField {
  return {
    id,
    name: `Field ${id}`,
    key: id,
    type: 'enum',
    required: false,
    version: 1,
    options: optionIds.map((optionId) => ({ id: optionId, label: `Opt ${optionId}` })),
  };
}

function record(id: string, groupByFieldId?: string, optionId?: string): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title: `Record ${id}`,
    position: id,
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values:
      groupByFieldId && optionId
        ? [
            {
              fieldId: groupByFieldId,
              textValue: null,
              integerValue: null,
              floatValue: null,
              booleanValue: null,
              dateValue: null,
              options: [],
              option: { id: optionId, label: `Opt ${optionId}` },
            },
          ]
        : [],
  };
}

const status = field('f-status', ['o1', 'o2']);

describe('fresh board config', () => {
  it('starts with an unset group-by sentinel and no card fields', () => {
    const config = freshBoardConfig();
    expect(config.groupByFieldId).toBe(UNSET_FIELD_ID);
    expect(config.cardFieldIds).toEqual([]);
  });
});

describe('boardLanes', () => {
  it('builds one lane per active option in field order plus Unassigned last', () => {
    const lanes = boardLanes(freshBoardConfig(), status, []);
    expect(lanes.map((lane) => lane.label)).toEqual(['Opt o1', 'Opt o2', 'Unassigned']);
    expect(lanes[0]!.option?.id).toBe('o1');
    expect(lanes[2]!.option).toBeNull();
    expect(lanes[2]!.key).toBe(`lane:${UNASSIGNED_LANE_KEY}`);
  });

  it('groups records by their joined option and parks unset values in Unassigned', () => {
    const records = [
      record('a', 'f-status', 'o1'),
      record('b', 'f-status', 'o2'),
      record('c', 'f-status', 'o1'),
      record('d'),
      record('e', 'other-field', 'o1'),
    ];
    const lanes = boardLanes(freshBoardConfig(), status, records);
    expect(lanes[0]!.records.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(lanes[1]!.records.map((entry) => entry.id)).toEqual(['b']);
    // Records without a value — or pointing at a removed option — land in Unassigned.
    expect(lanes[2]!.records.map((entry) => entry.id)).toEqual(['d', 'e']);
  });

  it('marks lanes collapsed from lane-prefixed hiddenColumns entries only', () => {
    const config = {
      ...freshBoardConfig(),
      hiddenColumns: [laneKey({ id: 'o1', label: 'x' }), 'field:f9'],
    };
    const lanes = boardLanes(config, status, []);
    expect(lanes.map((lane) => lane.collapsed)).toEqual([true, false, false]);
  });

  it('returns just the Unassigned lane when no group-by field resolves', () => {
    const lanes = boardLanes(freshBoardConfig(), undefined, [record('a')]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.label).toBe('Unassigned');
    expect(lanes[0]!.records.map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('board card columns', () => {
  it('resolves configured cardFieldIds into ordered columns and drops missing fields', () => {
    const config = { ...freshBoardConfig(), cardFieldIds: ['f-b', 'f-gone'] };
    const fields = [field('f-a', []), field('f-b', [])];
    const columns = boardCardColumns(config, fields);
    expect(columns.map((column) => column.key)).toEqual(['field:f-b']);
    expect(columns[0]!.label).toBe('Field f-b');
  });

  it('renders card secondary text through the shared grid cell renderer', () => {
    const columns = boardCardColumns({ ...freshBoardConfig(), cardFieldIds: ['f-status'] }, [
      status,
    ]);
    expect(boardCardText(record('a'), columns[0]!)).toBe('');
    expect(boardCardText(record('a', 'f-status', 'o2'), columns[0]!)).toBe('Opt o2');
  });
});

describe('lane helpers', () => {
  it('addresses lanes as lane:<id> keys', () => {
    expect(laneKey(null)).toBe(`lane:${UNASSIGNED_LANE_KEY}`);
    expect(laneKey({ id: 'o9', label: 'x' })).toBe('lane:o9');
  });

  it('finds the lane currently holding a record', () => {
    const lanes = boardLanes(freshBoardConfig(), status, [record('a', 'f-status', 'o2')]);
    expect(laneOfRecord(lanes, record('a'))?.key).toBe('lane:o2');
    expect(laneOfRecord(lanes, record('zzz'))).toBeUndefined();
  });
});
