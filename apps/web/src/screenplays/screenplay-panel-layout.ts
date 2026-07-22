import { z } from 'zod';
import { createBrowserUuid } from '../browser-uuid';
import {
  PanelLayoutOperationError,
  reducePanelLayout,
  type PanelLayoutAction,
} from '../workspace/layout';

export const SCREENPLAY_PANEL_LAYOUT_SCHEMA_VERSION = 2 as const;
export const SCREENPLAY_PANEL_LAYOUT_MAX_PANELS = 12;
export const SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH = 8;

export const screenplayPanelKindSchema = z.enum([
  'outline',
  'editor',
  'preview',
  'inventory',
  'statistics',
]);
export type ScreenplayPanelKind = z.infer<typeof screenplayPanelKindSchema>;

const idSchema = z.string().uuid();

const outlinePanelSchema = z
  .object({
    id: idSchema,
    type: z.literal('outline'),
    configVersion: z.literal(1),
    config: z
      .object({
        search: z.string().max(200),
        showSections: z.boolean(),
        showSynopses: z.boolean(),
        metadata: z.enum(['none', 'duration', 'pages', 'dialogue-density']).default('none'),
      })
      .strict(),
  })
  .strict();

const editorPanelSchema = z
  .object({
    id: idSchema,
    type: z.literal('editor'),
    configVersion: z.literal(1),
    config: z
      .object({
        fontSize: z.number().int().min(10).max(32),
        zoom: z.number().finite().min(0.5).max(3),
        showLineNumbers: z.boolean(),
        showPageBreaks: z.boolean().default(true),
        typewriterScrolling: z.boolean().default(false),
        focusMode: z.boolean().default(false),
        focusScope: z.enum(['paragraph', 'line']).default('paragraph'),
      })
      .strict(),
  })
  .strict();

const previewPanelSchema = z
  .object({
    id: idSchema,
    type: z.literal('preview'),
    configVersion: z.literal(1),
    config: z
      .object({
        zoom: z.number().finite().min(0.25).max(4),
        scrollSync: z.boolean(),
        zoomMode: z.enum(['fit-width', 'fit-page', 'custom']).default('fit-width'),
        pageView: z.enum(['single-page', 'two-page']).default('single-page'),
      })
      .strict(),
  })
  .strict();

const inventoryPanelSchema = z
  .object({
    id: idSchema,
    type: z.literal('inventory'),
    configVersion: z.literal(1),
    config: z
      .object({
        view: z.enum(['characters', 'locations', 'times', 'sections', 'notes']),
        search: z.string().max(200),
      })
      .strict(),
  })
  .strict();

const statisticsPanelSchema = z
  .object({
    id: idSchema,
    type: z.literal('statistics'),
    configVersion: z.literal(1),
    config: z
      .object({
        view: z.enum(['overview', 'characters', 'scenes', 'locations', 'structure']),
      })
      .strict(),
  })
  .strict();

export const screenplayPanelSchema = z.discriminatedUnion('type', [
  outlinePanelSchema,
  editorPanelSchema,
  previewPanelSchema,
  inventoryPanelSchema,
  statisticsPanelSchema,
]);
export type ScreenplayPanel = z.infer<typeof screenplayPanelSchema>;

export interface ScreenplayPanelSlot {
  kind: 'panel';
  id: string;
  panel: ScreenplayPanel;
}

export interface ScreenplaySplitNode {
  kind: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratioBasisPoints: number;
  first: ScreenplayPanelLayoutNode;
  second: ScreenplayPanelLayoutNode;
}

export type ScreenplayPanelLayoutNode = ScreenplayPanelSlot | ScreenplaySplitNode;

const screenplayPanelSlotSchema = z
  .object({ kind: z.literal('panel'), id: idSchema, panel: screenplayPanelSchema })
  .strict();

const screenplayPanelLayoutNodeSchema: z.ZodType<ScreenplayPanelLayoutNode> = z.lazy(() =>
  z.union([screenplayPanelSlotSchema, screenplaySplitNodeSchema]),
);

const screenplaySplitNodeSchema: z.ZodType<ScreenplaySplitNode> = z.lazy(() =>
  z
    .object({
      kind: z.literal('split'),
      id: idSchema,
      axis: z.enum(['horizontal', 'vertical']),
      ratioBasisPoints: z.number().int().min(500).max(9500),
      first: screenplayPanelLayoutNodeSchema,
      second: screenplayPanelLayoutNodeSchema,
    })
    .strict(),
);

function validateTree(root: ScreenplayPanelLayoutNode, context: z.RefinementCtx): void {
  const identifiers = new Set<string>();
  let panelCount = 0;
  const visit = (
    node: ScreenplayPanelLayoutNode,
    depth: number,
    path: (string | number)[],
  ): void => {
    if (depth > SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Screenplay panel layout depth cannot exceed ${SCREENPLAY_PANEL_LAYOUT_MAX_DEPTH}`,
      });
      return;
    }
    if (identifiers.has(node.id)) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'id'],
        message: 'Panel IDs must be unique',
      });
    }
    identifiers.add(node.id);
    if (node.kind === 'panel') {
      panelCount += 1;
      if (identifiers.has(node.panel.id)) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'panel', 'id'],
          message: 'Panel IDs must be unique',
        });
      }
      identifiers.add(node.panel.id);
      return;
    }
    visit(node.first, depth + 1, [...path, 'first']);
    visit(node.second, depth + 1, [...path, 'second']);
  };
  visit(root, 1, ['root']);
  if (panelCount > SCREENPLAY_PANEL_LAYOUT_MAX_PANELS) {
    context.addIssue({
      code: 'custom',
      path: ['root'],
      message: `Screenplay panel layout cannot contain more than ${SCREENPLAY_PANEL_LAYOUT_MAX_PANELS} panels`,
    });
  }
}

export const screenplayPanelLayoutSchema = z
  .object({
    schemaVersion: z.literal(SCREENPLAY_PANEL_LAYOUT_SCHEMA_VERSION),
    root: screenplayPanelLayoutNodeSchema,
  })
  .strict()
  .superRefine((layout, context) => validateTree(layout.root, context));

export type ScreenplayPanelLayout = z.infer<typeof screenplayPanelLayoutSchema>;

interface ScreenplayPanelDefinition {
  label: string;
  create: (id: string) => ScreenplayPanel;
}

export const screenplayPanelRegistry = {
  outline: {
    label: 'Outline',
    create: (id) => ({
      id,
      type: 'outline',
      configVersion: 1,
      config: {
        search: '',
        showSections: true,
        showSynopses: true,
        metadata: 'none',
      },
    }),
  },
  editor: {
    label: 'Editor',
    create: (id) => ({
      id,
      type: 'editor',
      configVersion: 1,
      config: {
        fontSize: 16,
        zoom: 1,
        showLineNumbers: true,
        showPageBreaks: true,
        typewriterScrolling: false,
        focusMode: false,
        focusScope: 'paragraph',
      },
    }),
  },
  preview: {
    label: 'Preview',
    create: (id) => ({
      id,
      type: 'preview',
      configVersion: 1,
      config: {
        zoom: 1,
        scrollSync: true,
        zoomMode: 'fit-width',
        pageView: 'single-page',
      },
    }),
  },
  inventory: {
    label: 'Inventory',
    create: (id) => ({
      id,
      type: 'inventory',
      configVersion: 1,
      config: { view: 'characters', search: '' },
    }),
  },
  statistics: {
    label: 'Statistics',
    create: (id) => ({
      id,
      type: 'statistics',
      configVersion: 1,
      config: { view: 'overview' },
    }),
  },
} satisfies Record<ScreenplayPanelKind, ScreenplayPanelDefinition>;

export function createScreenplayPanel(type: ScreenplayPanelKind, id: string): ScreenplayPanel {
  return screenplayPanelRegistry[type].create(id);
}

function defaultId(): string {
  return createBrowserUuid();
}

function slot(type: ScreenplayPanelKind, createId: () => string): ScreenplayPanelSlot {
  return {
    kind: 'panel',
    id: createId(),
    panel: createScreenplayPanel(type, createId()),
  };
}

export function createDefaultScreenplayPanelLayout(
  createId: () => string = defaultId,
): ScreenplayPanelLayout {
  return screenplayPanelLayoutSchema.parse({
    schemaVersion: SCREENPLAY_PANEL_LAYOUT_SCHEMA_VERSION,
    root: {
      kind: 'split',
      id: createId(),
      axis: 'horizontal',
      ratioBasisPoints: 8000,
      first: {
        kind: 'split',
        id: createId(),
        axis: 'horizontal',
        ratioBasisPoints: 5000,
        first: slot('editor', createId),
        second: slot('preview', createId),
      },
      second: {
        kind: 'split',
        id: createId(),
        axis: 'vertical',
        ratioBasisPoints: 5000,
        first: slot('outline', createId),
        second: slot('inventory', createId),
      },
    },
  });
}

export type ScreenplayPanelLayoutAction = PanelLayoutAction<ScreenplayPanel>;

export function reduceScreenplayPanelLayout(
  layout: ScreenplayPanelLayout,
  action: ScreenplayPanelLayoutAction,
): ScreenplayPanelLayout {
  return reducePanelLayout(layout, action, {
    clonePanel: (source, newPanelId) => ({ ...structuredClone(source), id: newPanelId }),
    validateLayout: (candidate) => {
      const result = screenplayPanelLayoutSchema.safeParse(candidate);
      if (!result.success) {
        throw new PanelLayoutOperationError(
          result.error.issues[0]?.message ?? 'Invalid screenplay panel layout',
        );
      }
      return result.data;
    },
  });
}
