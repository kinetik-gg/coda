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
  it('creates the 80/20 Editor / Statistics-over-Outline default (#193)', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    expect(collectPanelSlots(layout.root).map((entry) => entry.panel.type)).toEqual([
      'editor',
      'statistics',
      'outline',
    ]);
    expect(layout.root).toMatchObject({
      kind: 'split',
      axis: 'horizontal',
      ratioBasisPoints: 8000,
      first: { kind: 'panel' },
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
    expect(slots).toHaveLength(4);
  });

  it('swaps complete slots while preserving panel identity', () => {
    const layout = createDefaultScreenplayPanelLayout(deterministicIds());
    const [editor, statistics] = collectPanelSlots(layout.root);
    const result = reduceScreenplayPanelLayout(layout, {
      type: 'swap',
      firstSlotId: editor!.id,
      secondSlotId: statistics!.id,
    });

    const slots = collectPanelSlots(result.root);
    expect(slots[0]).toEqual(statistics);
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

    // The editor's right neighbour is now the whole sidebar branch rather than a sibling
    // preview pane (#193), so joining rightward absorbs it and leaves the editor alone.
    expect(collectPanelSlots(result.root).map((entry) => entry.panel.type)).toEqual(['editor']);
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

  it('creates a comments panel with an open-thread filter', () => {
    const panel = createScreenplayPanel('comments', ids[16]!);

    expect(panel).toEqual({
      id: ids[16],
      type: 'comments',
      configVersion: 1,
      config: { status: 'open' },
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
