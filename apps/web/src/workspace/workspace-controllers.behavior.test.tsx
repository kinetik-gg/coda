// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceRecipe } from './recipes';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import {
  columnIsVisible,
  contextParentId,
  entityTableColumns,
  hydratedItem,
} from './panels/entity-table-model';

afterEach(cleanup);

describe('workspace command and entity-table models', () => {
  it('handles every workspace command and clamps view settings', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const redo = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    let current = createWorkspaceRecipe([{ id: '10000000-0000-4000-8000-000000000001', level: 1 }]);
    function Harness() {
      const [layout, setLayout] = useState<typeof current | undefined>(current);
      useWorkspaceCommands({ setLayout, undo, redo, reset, publish });
      if (!layout) return null;
      current = layout;
      return null;
    }
    render(<Harness />);
    for (const name of [
      'undo-item',
      'redo-item',
      'reset-workspace',
      'publish-workspace',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
      'text-increase',
      'text-decrease',
      'text-reset',
    ]) {
      await act(async () => {
        window.dispatchEvent(new Event(`coda:${name}`));
        await Promise.resolve();
      });
    }
    expect([undo, redo, reset, publish].every((fn) => fn.mock.calls.length === 1)).toBe(true);
    expect(current.view).toEqual({ zoom: 1, textScale: 1.2 });
  });

  it('derives columns, visibility, ancestry context, and hydrated defaults', () => {
    const types = [
      { id: 'scene', singularName: 'Scene', pluralName: 'Scenes', level: 1, version: 1 },
      { id: 'shot', singularName: 'Shot', pluralName: 'Shots', level: 2, version: 1 },
    ];
    const field = {
      id: 'field',
      name: 'Status',
      key: 'status',
      type: 'TEXT',
      required: false,
      version: 1,
      options: [],
    };
    const columns = entityTableColumns(types[0]!, types, [field]);
    expect(columns.map((column) => column.key)).toEqual([
      'code',
      'title',
      'children',
      'field:field',
    ]);
    const panel = {
      id: '30000000-0000-4000-8000-000000000001',
      type: 'entity_table' as const,
      configVersion: 1 as const,
      config: {
        entityTypeId: 'scene',
        search: '',
        sort: 'manual' as const,
        direction: 'asc' as const,
        filters: [],
        hiddenColumns: ['code'],
        visibleCustomFieldIds: ['field'],
        columnWidths: {},
      },
    };
    expect(columnIsVisible(panel, columns[0]!)).toBe(false);
    expect(columnIsVisible(panel, columns.at(-1)!)).toBe(true);
    const item = hydratedItem({ id: 'item', entityTypeId: 'shot', title: 'Shot' });
    const active = {
      entityType: types[1]!,
      item: {
        ...item,
        parent: { id: 'scene-item', entityTypeId: 'scene', displayCode: null, title: 'Scene' },
      },
    };
    expect(contextParentId(types[1]!, types, active)).toBe('scene-item');
    expect(contextParentId(types[0]!, types, active)).toBeUndefined();
    expect(hydratedItem({ title: 'Updated' }, item)).toMatchObject({
      title: 'Updated',
      values: [],
    });
  });
});
