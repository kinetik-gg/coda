import { describe, expect, it } from 'vitest';
import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspacePanel,
  type WorkspacePanelSlot,
  type WorkspaceSplitNode,
} from '@coda/contracts';
import {
  closePanelAutomatically,
  collectPanelSlots,
  deriveAdjacency,
  deriveLayoutGeometry,
  generateAutomaticCloseCandidates,
  joinPanelDirectionally,
  LayoutOperationError,
  reconstructGuillotineTree,
  reduceWorkspaceLayout,
  UNIT_LAYOUT_RECT,
  validateWorkspaceLayout,
} from './index';

const ids = {
  root: '00000000-0000-4000-8000-000000000001',
  bottom: '00000000-0000-4000-8000-000000000002',
  topSlot: '00000000-0000-4000-8000-000000000003',
  topPanel: '00000000-0000-4000-8000-000000000004',
  leftSlot: '00000000-0000-4000-8000-000000000005',
  leftPanel: '00000000-0000-4000-8000-000000000006',
  rightSlot: '00000000-0000-4000-8000-000000000007',
  rightPanel: '00000000-0000-4000-8000-000000000008',
  splitNew: '00000000-0000-4000-8000-000000000009',
  slotNew: '00000000-0000-4000-8000-00000000000a',
  panelNew: '00000000-0000-4000-8000-00000000000b',
} as const;

function panel(id: string, type: WorkspacePanel['type']): WorkspacePanel {
  if (type === 'entity_table')
    return {
      id,
      type,
      configVersion: 1,
      config: {
        entityTypeId: null,
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
    return { id, type, configVersion: 1, config: { section: 'details', search: '' } };
  if (type === 'pdf')
    return {
      id,
      type,
      configVersion: 1,
      config: { sourceDocumentId: null, page: 1, zoom: 1 },
    };
  return { id, type, configVersion: 1, config: { search: '' } };
}

function slot(id: string, panelId: string, type: WorkspacePanel['type']): WorkspacePanelSlot {
  return { kind: 'panel', id, panel: panel(panelId, type) };
}

function wideTopLayout(): WorkspaceLayout {
  return {
    schemaVersion: 1,
    root: {
      kind: 'split',
      id: ids.root,
      axis: 'vertical',
      ratioBasisPoints: 4000,
      first: slot(ids.topSlot, ids.topPanel, 'pdf'),
      second: {
        kind: 'split',
        id: ids.bottom,
        axis: 'horizontal',
        ratioBasisPoints: 5000,
        first: slot(ids.leftSlot, ids.leftPanel, 'entity_table'),
        second: slot(ids.rightSlot, ids.rightPanel, 'inspector'),
      },
    },
  };
}

describe('workspace layout geometry', () => {
  it('derives normalized rectangles and T-junction adjacency', () => {
    const layout = wideTopLayout();
    const geometry = deriveLayoutGeometry(layout);
    expect(geometry.slotRects.get(ids.topSlot)).toEqual({ x: 0, y: 0, width: 1, height: 0.4 });
    expect(geometry.slotRects.get(ids.leftSlot)).toEqual({
      x: 0,
      y: 0.4,
      width: 0.5,
      height: 0.6,
    });
    expect(geometry.slotRects.get(ids.rightSlot)).toEqual({
      x: 0.5,
      y: 0.4,
      width: 0.5,
      height: 0.6,
    });
    const down = deriveAdjacency(layout).filter(
      (entry) => entry.fromSlotId === ids.topSlot && entry.direction === 'down',
    );
    expect(down).toEqual([
      { fromSlotId: ids.topSlot, toSlotId: ids.leftSlot, direction: 'down', sharedEdge: 0.5 },
      { fromSlotId: ids.topSlot, toSlotId: ids.rightSlot, direction: 'down', sharedEdge: 0.5 },
    ]);
  });

  it('reconstructs a guillotine tree from derived rectangles', () => {
    const layout = wideTopLayout();
    const geometry = deriveLayoutGeometry(layout);
    const panels = collectPanelSlots(layout.root).map((entry) => ({
      slot: entry,
      rect: geometry.slotRects.get(entry.id)!,
    }));
    const root = reconstructGuillotineTree(panels, UNIT_LAYOUT_RECT, [ids.root, ids.bottom]);
    expect(root).not.toBeNull();
    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root }).success).toBe(true);
    expect(
      collectPanelSlots(root!)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([ids.topSlot, ids.leftSlot, ids.rightSlot].sort());
  });
});

describe('automatic panel close', () => {
  it('fills a wide top panel from both bottom neighbors', () => {
    const layout = wideTopLayout();
    const candidates = generateAutomaticCloseCandidates(layout, ids.topSlot);
    expect(candidates.some((candidate) => candidate.kind === 'sibling-fallback')).toBe(true);
    const result = closePanelAutomatically(layout, ids.topSlot)!;
    const geometry = deriveLayoutGeometry(result);
    expect([...geometry.slotRects.keys()].sort()).toEqual([ids.leftSlot, ids.rightSlot].sort());
    expect(geometry.slotRects.get(ids.leftSlot)).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    expect(geometry.slotRects.get(ids.rightSlot)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(workspaceLayoutSchema.safeParse(result).success).toBe(true);
  });

  it('lexicographically prefers changing one adjacent panel', () => {
    const layout = wideTopLayout();
    const candidates = generateAutomaticCloseCandidates(layout, ids.leftSlot);
    expect(candidates[0]?.score.changedPanels).toBe(1);
    const result = candidates[0]!.layout;
    const geometry = deriveLayoutGeometry(result);
    expect(geometry.slotRects.get(ids.topSlot)).toEqual({ x: 0, y: 0, width: 1, height: 0.4 });
    expect(geometry.slotRects.get(ids.rightSlot)).toEqual({ x: 0, y: 0.4, width: 1, height: 0.6 });
  });

  it('does not close the final panel or an unknown panel', () => {
    const single: WorkspaceLayout = {
      schemaVersion: 1,
      root: slot(ids.topSlot, ids.topPanel, 'pdf'),
    };
    expect(closePanelAutomatically(single, ids.topSlot)).toBeNull();
    expect(closePanelAutomatically(wideTopLayout(), ids.panelNew)).toBeNull();
  });
});

describe('directional ancestor joins', () => {
  it('promotes the two-panel bottom subtree when its boundary panel joins upward', () => {
    const result = joinPanelDirectionally(wideTopLayout(), ids.leftSlot, 'up')!;
    expect(
      collectPanelSlots(result.root)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([ids.leftSlot, ids.rightSlot].sort());
    const geometry = deriveLayoutGeometry(result);
    expect(geometry.slotRects.get(ids.leftSlot)?.height).toBe(1);
    expect(geometry.slotRects.get(ids.rightSlot)?.height).toBe(1);
  });

  it('removes the adjacent ancestor branch from the wide top panel', () => {
    const result = joinPanelDirectionally(wideTopLayout(), ids.topSlot, 'down')!;
    expect(result.root).toMatchObject({ kind: 'panel', id: ids.topSlot });
    expect(joinPanelDirectionally(wideTopLayout(), ids.topSlot, 'up')).toBeNull();
  });

  it('uses the nearest eligible branch in the requested direction', () => {
    const result = joinPanelDirectionally(wideTopLayout(), ids.leftSlot, 'right')!;
    expect(
      collectPanelSlots(result.root)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([ids.topSlot, ids.leftSlot].sort());
  });
});

describe('workspace layout reducer', () => {
  it('splits without mutating the source panel configuration', () => {
    const layout = wideTopLayout();
    const before = JSON.stringify(layout);
    const result = reduceWorkspaceLayout(layout, {
      type: 'split',
      slotId: ids.leftSlot,
      axis: 'vertical',
      ratioBasisPoints: 6000,
      splitId: ids.splitNew,
      newSlotId: ids.slotNew,
      newPanelId: ids.panelNew,
    });
    expect(JSON.stringify(layout)).toBe(before);
    const original = collectPanelSlots(result.root).find((entry) => entry.id === ids.leftSlot)!;
    const duplicate = collectPanelSlots(result.root).find((entry) => entry.id === ids.slotNew)!;
    expect(duplicate.panel.type).toBe(original.panel.type);
    expect(duplicate.panel.config).toEqual(original.panel.config);
    expect(duplicate.panel.config).not.toBe(original.panel.config);
    expect(collectPanelSlots(result.root)).toHaveLength(4);
  });

  it('swaps complete panel slots and preserves the input tree', () => {
    const layout = wideTopLayout();
    const result = reduceWorkspaceLayout(layout, {
      type: 'swap',
      firstSlotId: ids.topSlot,
      secondSlotId: ids.leftSlot,
    });
    const root = result.root as WorkspaceSplitNode;
    expect(root.first).toMatchObject({ id: ids.leftSlot, panel: { id: ids.leftPanel } });
    expect((root.second as WorkspaceSplitNode).first).toMatchObject({
      id: ids.topSlot,
      panel: { id: ids.topPanel },
    });
    expect((layout.root as WorkspaceSplitNode).first.id).toBe(ids.topSlot);
  });

  it('commits ratios immutably and validates their range', () => {
    const layout = wideTopLayout();
    const result = reduceWorkspaceLayout(layout, {
      type: 'set-ratio',
      splitId: ids.root,
      ratioBasisPoints: 6500,
    });
    expect((result.root as WorkspaceSplitNode).ratioBasisPoints).toBe(6500);
    expect((layout.root as WorkspaceSplitNode).ratioBasisPoints).toBe(4000);
    expect(() =>
      reduceWorkspaceLayout(layout, {
        type: 'set-ratio',
        splitId: ids.root,
        ratioBasisPoints: 200,
      }),
    ).toThrow(LayoutOperationError);
  });

  it('routes close and join actions through validated rewrites', () => {
    const closed = reduceWorkspaceLayout(wideTopLayout(), {
      type: 'close',
      slotId: ids.topSlot,
    });
    const joined = reduceWorkspaceLayout(wideTopLayout(), {
      type: 'join',
      slotId: ids.leftSlot,
      direction: 'up',
    });
    expect(validateWorkspaceLayout(closed)).toEqual(closed);
    expect(validateWorkspaceLayout(joined)).toEqual(joined);
  });

  it('rejects impossible operations', () => {
    expect(() =>
      reduceWorkspaceLayout(wideTopLayout(), { type: 'close', slotId: ids.panelNew }),
    ).toThrow(LayoutOperationError);
    expect(() =>
      reduceWorkspaceLayout(wideTopLayout(), {
        type: 'join',
        slotId: ids.topSlot,
        direction: 'up',
      }),
    ).toThrow(LayoutOperationError);
  });
});
