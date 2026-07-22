import { describe, expect, it } from 'vitest';
import { workspaceLayoutSchema } from '@coda/contracts';
import { collectPanelSlots } from '../workspace/layout';
import {
  createDefaultScreenplayPanelLayout,
  createScreenplayPanel,
  reduceScreenplayPanelLayout,
  screenplayPanelLayoutSchema,
} from './screenplay-panel-layout';

const ids = Array.from(
  { length: 24 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function deterministicIds(): () => string {
  let index = 0;
  return () => ids[index++]!;
}

describe('screenplay panel layout', () => {
  it('creates the 40/40/20 Editor / Preview / sidebar default', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    expect(collectPanelSlots(layout.root).map((entry) => entry.panel.type)).toEqual([
      'editor',
      'preview',
      'outline',
      'inventory',
    ]);
    expect(layout.root).toMatchObject({
      kind: 'split',
      axis: 'horizontal',
      ratioBasisPoints: 8000,
      first: { kind: 'split', axis: 'horizontal', ratioBasisPoints: 5000 },
      second: { kind: 'split', axis: 'vertical', ratioBasisPoints: 5000 },
    });
    expect(screenplayPanelLayoutSchema.safeParse(layout).success).toBe(true);
    expect(workspaceLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it('splits a panel by cloning its typed configuration without mutating the source', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    const editor = collectPanelSlots(layout.root)[0]!;
    const before = JSON.stringify(layout);
    const result = reduceScreenplayPanelLayout(layout, {
      type: 'split',
      slotId: editor.id,
      axis: 'vertical',
      ratioBasisPoints: 5000,
      splitId: ids[16]!,
      newSlotId: ids[17]!,
      newPanelId: ids[18]!,
    });

    expect(JSON.stringify(layout)).toBe(before);
    const slots = collectPanelSlots(result.root);
    const duplicate = slots.find((entry) => entry.id === ids[17]);
    expect(duplicate?.panel).toMatchObject({ id: ids[18], type: 'editor' });
    expect(duplicate?.panel.config).toEqual(editor.panel.config);
    expect(duplicate?.panel.config).not.toBe(editor.panel.config);
    expect(slots).toHaveLength(5);
  });

  it('swaps complete slots while preserving panel identity', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    const [editor, preview] = collectPanelSlots(layout.root);
    const result = reduceScreenplayPanelLayout(layout, {
      type: 'swap',
      firstSlotId: editor!.id,
      secondSlotId: preview!.id,
    });

    const slots = collectPanelSlots(result.root);
    expect(slots[0]).toEqual(preview);
    expect(slots[1]).toEqual(editor);
    expect(collectPanelSlots(layout.root)[0]).toEqual(editor);
  });

  it('joins toward an adjacent branch using the shared workspace geometry', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    const editor = collectPanelSlots(layout.root)[0]!;
    const result = reduceScreenplayPanelLayout(layout, {
      type: 'join',
      slotId: editor.id,
      direction: 'right',
    });

    expect(collectPanelSlots(result.root).map((entry) => entry.panel.type)).toEqual([
      'editor',
      'outline',
      'inventory',
    ]);
    expect(screenplayPanelLayoutSchema.safeParse(result).success).toBe(true);
  });

  it('replaces the function of a slot without changing its layout position', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    const editor = collectPanelSlots(layout.root)[0]!;
    const replacement = createScreenplayPanel('preview', ids[16]!);
    const result = reduceScreenplayPanelLayout(layout, {
      type: 'replace',
      slotId: editor.id,
      panel: replacement,
    });

    const replaced = collectPanelSlots(result.root).find((entry) => entry.id === editor.id);
    expect(replaced?.panel).toEqual(replacement);
    expect(collectPanelSlots(layout.root)[0]?.panel.type).toBe('editor');
  });

  it('creates a reusable statistics panel with typed view configuration', () => {
    const panel = createScreenplayPanel('statistics', ids[16]!);

    expect(panel).toEqual({
      id: ids[16],
      type: 'statistics',
      configVersion: 1,
      config: { view: 'overview' },
    });
    expect(
      screenplayPanelLayoutSchema.safeParse({
        schemaVersion: 2,
        root: { kind: 'panel', id: ids[17], panel },
      }).success,
    ).toBe(true);
  });

  it('fills new view settings when restoring older persisted panel configurations', () => {
    const editorLayout = screenplayPanelLayoutSchema.parse({
      schemaVersion: 2,
      root: {
        kind: 'panel',
        id: ids[16],
        panel: {
          id: ids[17],
          type: 'editor',
          configVersion: 1,
          config: { fontSize: 16, zoom: 1, showLineNumbers: true },
        },
      },
    });
    const previewLayout = screenplayPanelLayoutSchema.parse({
      schemaVersion: 2,
      root: {
        kind: 'panel',
        id: ids[18],
        panel: {
          id: ids[19],
          type: 'preview',
          configVersion: 1,
          config: { zoom: 1, scrollSync: true },
        },
      },
    });
    const outlineLayout = screenplayPanelLayoutSchema.parse({
      schemaVersion: 2,
      root: {
        kind: 'panel',
        id: ids[20],
        panel: {
          id: ids[21],
          type: 'outline',
          configVersion: 1,
          config: { search: '', showSections: true, showSynopses: true },
        },
      },
    });

    expect(editorLayout.root).toMatchObject({
      panel: {
        config: {
          showPageBreaks: true,
          typewriterScrolling: false,
          focusMode: false,
          focusScope: 'paragraph',
        },
      },
    });
    expect(previewLayout.root).toMatchObject({
      panel: { config: { zoomMode: 'fit-width', pageView: 'single-page' } },
    });
    expect(outlineLayout.root).toMatchObject({
      panel: { config: { metadata: 'none' } },
    });
  });
});
