import { z } from 'zod';

export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_LAYOUT_MAX_PANELS = 12;
export const WORKSPACE_LAYOUT_MAX_DEPTH = 8;

const workspaceUuidSchema = z.string().uuid();

export const workspacePanelTypeSchema = z.enum([
  'entity_table',
  'inspector',
  'pdf',
  'activity',
  'trash',
]);
export type WorkspacePanelType = z.infer<typeof workspacePanelTypeSchema>;

const workspaceSortSchema = z.enum(['manual', 'title', 'code', 'created_at', 'updated_at']);
const workspaceFilterOperatorSchema = z.enum([
  'contains',
  'equals',
  'not_equals',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
  'is_empty',
  'is_not_empty',
  'has_any',
  'has_all',
]);

export const workspaceEntityTableFilterSchema = z
  .object({
    fieldId: workspaceUuidSchema,
    operator: workspaceFilterOperatorSchema,
    value: z
      .union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()).max(100)])
      .optional(),
  })
  .strict();

export const workspaceEntityTableConfigSchema = z
  .object({
    entityTypeId: workspaceUuidSchema.nullable(),
    search: z.string().max(200),
    sort: workspaceSortSchema,
    direction: z.enum(['asc', 'desc']),
    filters: z.array(workspaceEntityTableFilterSchema).max(20),
    hiddenColumns: z.array(z.string().max(120)).max(200).default([]),
    visibleCustomFieldIds: z.array(workspaceUuidSchema).max(200).default([]),
    columnWidths: z.record(z.string().max(120), z.number().int().min(48).max(1600)).default({}),
  })
  .strict();

export const workspaceInspectorConfigSchema = z
  .object({
    section: z.enum(['details', 'comments', 'references', 'activity']),
    search: z.string().max(200).default(''),
  })
  .strict();

export const workspacePdfConfigSchema = z
  .object({
    sourceDocumentId: workspaceUuidSchema.nullable(),
    page: z.number().int().min(1),
    zoom: z.number().finite().min(0.25).max(4),
    darkView: z.boolean().optional(),
  })
  .strict();

export const workspaceActivityConfigSchema = z
  .object({ search: z.string().max(200).default('') })
  .strict();

export const workspaceTrashConfigSchema = z
  .object({ search: z.string().max(200).default('') })
  .strict();

export const workspacePanelSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: workspaceUuidSchema,
      type: z.literal('entity_table'),
      configVersion: z.literal(1),
      config: workspaceEntityTableConfigSchema,
    })
    .strict(),
  z
    .object({
      id: workspaceUuidSchema,
      type: z.literal('inspector'),
      configVersion: z.literal(1),
      config: workspaceInspectorConfigSchema,
    })
    .strict(),
  z
    .object({
      id: workspaceUuidSchema,
      type: z.literal('pdf'),
      configVersion: z.literal(1),
      config: workspacePdfConfigSchema,
    })
    .strict(),
  z
    .object({
      id: workspaceUuidSchema,
      type: z.literal('activity'),
      configVersion: z.literal(1),
      config: workspaceActivityConfigSchema,
    })
    .strict(),
  z
    .object({
      id: workspaceUuidSchema,
      type: z.literal('trash'),
      configVersion: z.literal(1),
      config: workspaceTrashConfigSchema,
    })
    .strict(),
]);
export type WorkspacePanel = z.infer<typeof workspacePanelSchema>;

export const workspacePanelSlotSchema = z
  .object({
    kind: z.literal('panel'),
    id: workspaceUuidSchema,
    panel: workspacePanelSchema,
  })
  .strict();
export type WorkspacePanelSlot = z.infer<typeof workspacePanelSlotSchema>;

export const workspaceViewSchema = z
  .object({
    zoom: z.number().finite().min(0.75).max(1.5),
    textScale: z.number().finite().min(0.8).max(1.4),
  })
  .strict();
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

export interface WorkspaceSplitNode {
  kind: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratioBasisPoints: number;
  first: WorkspaceLayoutNode;
  second: WorkspaceLayoutNode;
}

export type WorkspaceLayoutNode = WorkspacePanelSlot | WorkspaceSplitNode;

export const workspaceLayoutNodeSchema = z.lazy(() =>
  z.union([workspacePanelSlotSchema, workspaceSplitNodeSchema]),
) as z.ZodType<WorkspaceLayoutNode>;

export const workspaceSplitNodeSchema = z.lazy(() =>
  z
    .object({
      kind: z.literal('split'),
      id: workspaceUuidSchema,
      axis: z.enum(['horizontal', 'vertical']),
      ratioBasisPoints: z.number().int().min(500).max(9500),
      first: workspaceLayoutNodeSchema,
      second: workspaceLayoutNodeSchema,
    })
    .strict(),
) as z.ZodType<WorkspaceSplitNode>;

function validateWorkspaceTree(root: WorkspaceLayoutNode, context: z.RefinementCtx): void {
  const identifiers = new Set<string>();
  let panelCount = 0;

  const visit = (node: WorkspaceLayoutNode, depth: number, path: (string | number)[]): void => {
    if (depth > WORKSPACE_LAYOUT_MAX_DEPTH) {
      context.addIssue({
        code: 'custom',
        path,
        message: `Workspace layout depth cannot exceed ${WORKSPACE_LAYOUT_MAX_DEPTH}`,
      });
      return;
    }

    if (identifiers.has(node.id)) {
      context.addIssue({
        code: 'custom',
        path: [...path, 'id'],
        message: 'Workspace IDs must be unique',
      });
    }
    identifiers.add(node.id);

    if (node.kind === 'panel') {
      panelCount += 1;
      if (identifiers.has(node.panel.id)) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'panel', 'id'],
          message: 'Workspace IDs must be unique',
        });
      }
      identifiers.add(node.panel.id);
      return;
    }

    visit(node.first, depth + 1, [...path, 'first']);
    visit(node.second, depth + 1, [...path, 'second']);
  };

  visit(root, 1, ['root']);
  if (panelCount > WORKSPACE_LAYOUT_MAX_PANELS) {
    context.addIssue({
      code: 'custom',
      path: ['root'],
      message: `Workspace layout cannot contain more than ${WORKSPACE_LAYOUT_MAX_PANELS} panels`,
    });
  }
}

export const workspaceLayoutSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_LAYOUT_SCHEMA_VERSION),
    root: workspaceLayoutNodeSchema,
    view: workspaceViewSchema.optional(),
  })
  .strict()
  .superRefine((layout, context) => validateWorkspaceTree(layout.root, context));
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

export const saveWorkspaceLayoutSchema = z
  .object({
    layout: workspaceLayoutSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export const resetWorkspaceLayoutSchema = z
  .object({ expectedRevision: z.number().int().min(0) })
  .strict();

export const publishWorkspaceLayoutSchema = z
  .object({
    personalRevision: z.number().int().min(0),
    defaultRevision: z.number().int().min(0),
  })
  .strict();
