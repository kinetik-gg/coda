import type { WorkspaceLayoutNode } from '@coda/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceRecipe } from './recipes';

function panels(node: WorkspaceLayoutNode): WorkspaceLayoutNode[] {
  if (node.kind === 'panel') return [node];
  return [...panels(node.first), ...panels(node.second)];
}

describe('workspace recipes', () => {
  it('creates a stable one-level table and inspector layout', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
    const layout = createWorkspaceRecipe([
      { id: '10000000-0000-4000-8000-000000000001', level: 1 },
    ]);
    const slots = panels(layout.root);
    expect(layout.view).toEqual({ zoom: 1, textScale: 1.2 });
    expect(slots.map((slot) => (slot.kind === 'panel' ? slot.panel.type : 'split'))).toEqual([
      'entity_table',
      'inspector',
    ]);
  });

  it('sorts two levels and assigns a table to each entity type', () => {
    const layout = createWorkspaceRecipe([
      { id: '20000000-0000-4000-8000-000000000002', level: 2 },
      { id: '20000000-0000-4000-8000-000000000001', level: 1 },
    ]);
    const types = panels(layout.root)
      .filter((slot) => slot.kind === 'panel' && slot.panel.type === 'entity_table')
      .map((slot) =>
        slot.kind === 'panel' && slot.panel.type === 'entity_table'
          ? slot.panel.config.entityTypeId
          : null,
      );
    expect(types).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
    ]);
  });

  it('creates the three-level analysis recipe with a PDF panel', () => {
    const layout = createWorkspaceRecipe([
      { id: '30000000-0000-4000-8000-000000000001', level: 1 },
      { id: '30000000-0000-4000-8000-000000000002', level: 2 },
      { id: '30000000-0000-4000-8000-000000000003', level: 3 },
    ]);
    const kinds = panels(layout.root).map((slot) =>
      slot.kind === 'panel' ? slot.panel.type : 'split',
    );
    expect(kinds).toEqual(['entity_table', 'entity_table', 'entity_table', 'inspector', 'pdf']);
  });

  it('creates a valid empty-project fallback instead of an unusable table', () => {
    const layout = createWorkspaceRecipe([]);
    const first = panels(layout.root)[0];
    expect(first?.kind).toBe('panel');
    if (first?.kind === 'panel' && first.panel.type === 'entity_table') {
      expect(first.panel.config.entityTypeId).toBeNull();
    }
  });
});
