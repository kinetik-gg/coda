import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_LAYOUT_MAX_DEPTH,
  WORKSPACE_LAYOUT_MAX_PANELS,
  publishWorkspaceLayoutSchema,
  workspaceLayoutSchema,
  type WorkspaceLayoutNode,
  type WorkspacePanelSlot,
} from './workspace-layout';

let idCounter = 1;
const uuid = () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, '0')}`;

function panel(type: 'entity_table' | 'inspector' | 'pdf' = 'inspector'): WorkspacePanelSlot {
  const config =
    type === 'entity_table'
      ? {
          entityTypeId: null,
          search: '',
          sort: 'manual' as const,
          direction: 'asc' as const,
          filters: [],
        }
      : type === 'pdf'
        ? { sourceDocumentId: null, page: 1, zoom: 1 }
        : { section: 'details' as const, search: '' };

  return {
    kind: 'panel',
    id: uuid(),
    panel: { id: uuid(), type, configVersion: 1, config } as WorkspacePanelSlot['panel'],
  };
}

function split(first: WorkspaceLayoutNode, second: WorkspaceLayoutNode): WorkspaceLayoutNode {
  return {
    kind: 'split',
    id: uuid(),
    axis: 'horizontal',
    ratioBasisPoints: 5000,
    first,
    second,
  };
}

function balancedPanels(count: number): WorkspaceLayoutNode {
  if (count === 1) return panel();
  const firstCount = Math.floor(count / 2);
  return split(balancedPanels(firstCount), balancedPanels(count - firstCount));
}

describe('workspaceLayoutSchema', () => {
  it('accepts a strict version 1 recursive layout', () => {
    const result = workspaceLayoutSchema.safeParse({
      schemaVersion: 1,
      root: split(panel('entity_table'), split(panel('pdf'), panel('inspector'))),
    });

    expect(result.success).toBe(true);
  });

  it('defaults legacy entity tables to core columns and persists opted-in fields and widths', () => {
    const legacy = workspaceLayoutSchema.parse({ schemaVersion: 1, root: panel('entity_table') });
    expect(legacy.root.kind).toBe('panel');
    if (legacy.root.kind !== 'panel' || legacy.root.panel.type !== 'entity_table') return;
    expect(legacy.root.panel.config.visibleCustomFieldIds).toEqual([]);
    expect(legacy.root.panel.config.columnWidths).toEqual({});

    const fieldId = uuid();
    const configuredRoot = panel('entity_table');
    if (configuredRoot.panel.type !== 'entity_table') return;
    configuredRoot.panel.config.visibleCustomFieldIds = [fieldId];
    configuredRoot.panel.config.columnWidths = { [`field:${fieldId}`]: 320 };
    const configured = workspaceLayoutSchema.parse({ schemaVersion: 1, root: configuredRoot });
    if (configured.root.kind !== 'panel' || configured.root.panel.type !== 'entity_table') return;
    expect(configured.root.panel.config.visibleCustomFieldIds).toEqual([fieldId]);
    expect(configured.root.panel.config.columnWidths).toEqual({ [`field:${fieldId}`]: 320 });
  });

  it('accepts both legacy PDF configs and an explicit dark-view preference', () => {
    const legacy = panel('pdf');
    const dark = panel('pdf');
    if (dark.panel.type === 'pdf') dark.panel.config.darkView = true;

    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root: legacy }).success).toBe(true);
    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root: dark }).success).toBe(true);
  });

  it('accepts optional persisted view preferences without requiring them on legacy layouts', () => {
    const root = panel();
    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root }).success).toBe(true);
    expect(
      workspaceLayoutSchema.safeParse({
        schemaVersion: 1,
        root,
        view: { zoom: 1.25, textScale: 1.1 },
      }).success,
    ).toBe(true);
    expect(
      workspaceLayoutSchema.safeParse({
        schemaVersion: 1,
        root,
        view: { zoom: 2, textScale: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown properties, invalid ratios, and mismatched panel configs', () => {
    const extra = workspaceLayoutSchema.safeParse({
      schemaVersion: 1,
      root: { ...panel(), extra: true },
    });
    const ratio = workspaceLayoutSchema.safeParse({
      schemaVersion: 1,
      root: { ...split(panel(), panel()), ratioBasisPoints: 499 },
    });
    const config = workspaceLayoutSchema.safeParse({
      schemaVersion: 1,
      root: {
        ...panel('pdf'),
        panel: { ...panel('pdf').panel, config: { section: 'details' } },
      },
    });

    expect(extra.success).toBe(false);
    expect(ratio.success).toBe(false);
    expect(config.success).toBe(false);
  });

  it('rejects duplicate node or panel identifiers, including cross-kind duplicates', () => {
    const first = panel();
    const second = panel();
    second.id = first.panel.id;
    const result = workspaceLayoutSchema.safeParse({
      schemaVersion: 1,
      root: split(first, second),
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.path.at(-1) === 'id')).toBe(true);
  });

  it('rejects duplicate panel identifiers', () => {
    const first = panel();
    const second = panel();
    second.panel.id = first.panel.id;
    expect(
      workspaceLayoutSchema.safeParse({ schemaVersion: 1, root: split(first, second) }).success,
    ).toBe(false);
  });

  it(`rejects more than ${WORKSPACE_LAYOUT_MAX_PANELS} panels`, () => {
    const root = balancedPanels(WORKSPACE_LAYOUT_MAX_PANELS + 1);
    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root }).success).toBe(false);
  });

  it(`rejects trees deeper than ${WORKSPACE_LAYOUT_MAX_DEPTH}`, () => {
    let root: WorkspaceLayoutNode = panel();
    for (let index = 0; index < WORKSPACE_LAYOUT_MAX_DEPTH; index += 1) {
      root = split(root, panel());
    }
    expect(workspaceLayoutSchema.safeParse({ schemaVersion: 1, root }).success).toBe(false);
  });

  it('requires both personal and published revisions when publishing a layout', () => {
    expect(
      publishWorkspaceLayoutSchema.safeParse({ personalRevision: 2, defaultRevision: 4 }).success,
    ).toBe(true);
    expect(publishWorkspaceLayoutSchema.safeParse({ personalRevision: 2 }).success).toBe(false);
  });
});
