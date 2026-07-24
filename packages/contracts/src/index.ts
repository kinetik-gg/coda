import { z } from 'zod';
import { passwordSchema } from './password-policy';
import { storageConnectionInputSchema } from './storage-wizard';

export * from './storage-wizard';

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_EMAIL_LOCAL_PART_MIN_LENGTH,
  PASSWORD_TOO_COMMON_MESSAGE,
  PASSWORD_CONTAINS_EMAIL_MESSAGE,
  passwordSchema,
  passwordContainsEmailLocalPart,
} from './password-policy';
export { COMMON_PASSWORDS } from './common-passwords';
export {
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  WORKSPACE_LAYOUT_MAX_PANELS,
  WORKSPACE_LAYOUT_MAX_DEPTH,
  workspacePanelTypeSchema,
  workspaceEntityTableFilterSchema,
  workspaceEntityTableConfigSchema,
  workspaceInspectorConfigSchema,
  workspacePdfConfigSchema,
  workspacePanelSchema,
  workspacePanelSlotSchema,
  workspaceLayoutNodeSchema,
  workspaceSplitNodeSchema,
  workspaceLayoutSchema,
  saveWorkspaceLayoutSchema,
  resetWorkspaceLayoutSchema,
  publishWorkspaceLayoutSchema,
} from './workspace-layout';
export type {
  WorkspacePanelType,
  WorkspacePanel,
  WorkspacePanelSlot,
  WorkspaceSplitNode,
  WorkspaceLayoutNode,
  WorkspaceLayout,
} from './workspace-layout';
export {
  scheduledBackupRetentionSchema,
  scheduledBackupSettingsSchema,
  scheduledBackupOutcomeSchema,
  DEFAULT_SCHEDULED_BACKUP_RETENTION,
  DEFAULT_SCHEDULED_BACKUP_SETTINGS,
} from './scheduled-backup';
export type {
  ScheduledBackupRetention,
  ScheduledBackupSettings,
  ScheduledBackupOutcome,
  ScheduledBackupHistoryEntry,
  ScheduledBackupDestinationSource,
  ScheduledBackupDestinationView,
  ScheduledBackupStatusView,
  ScheduledBackupView,
  ScheduledBackupRunResult,
  ScheduledBackupDestinationResult,
} from './scheduled-backup';

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const permissionSchema = z.enum([
  'read_project',
  'manage_items',
  'manage_entity_types',
  'manage_fields',
  'manage_source_documents',
  'manage_storage_objects',
  'comment',
  'invite_members',
  'manage_member_roles',
  'manage_roles',
  'manage_project_settings',
  'delete_project',
]);
export type Permission = z.infer<typeof permissionSchema>;

export const allPermissions = permissionSchema.options;

export const fieldTypeSchema = z.enum([
  'text',
  'long_text',
  'enum',
  'multi_enum',
  'integer',
  'float',
  'boolean',
  'date',
  'file',
  'image',
  'video',
]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const storageKindSchema = z.enum(['source_document', 'file', 'image', 'video']);
export type StorageKind = z.infer<typeof storageKindSchema>;

export const setupOwnerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  company: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(512),
  email: emailSchema.optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
  company: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
});

export const updateAccountProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    email: emailSchema.optional(),
    company: z.string().trim().max(160).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one profile field is required',
  });

export const changeAccountPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const accountThemeSchema = z.enum([
  'coda-dark',
  'light',
  'catppuccin-mocha',
  'dracula',
  'nord',
  'gruvbox-dark',
  'solarized-dark',
  'tokyo-night',
  'one-dark',
  'everforest',
  'rose-pine',
]);
export const accountFontSizeSchema = z.enum(['small', 'default', 'medium', 'large']);
export const accountMotionSchema = z.enum(['system', 'reduced']);
export const accountPdfAppearanceSchema = z.enum(['theme', 'light', 'dark']);
export const updateAccountPreferencesSchema = z.object({
  theme: accountThemeSchema,
  fontSize: accountFontSizeSchema,
  motion: accountMotionSchema,
  pdfAppearance: accountPdfAppearanceSchema,
});
export type AccountPreferences = z.infer<typeof updateAccountPreferencesSchema>;

export const apiCredentialKindSchema = z.enum(['api_key', 'mcp_token']);
export type ApiCredentialKind = z.infer<typeof apiCredentialKindSchema>;

export const createApiCredentialSchema = z.object({
  projectId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  kind: apiCredentialKindSchema,
  permissions: z
    .array(permissionSchema)
    .min(1)
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: 'Permissions must be unique',
    }),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreateApiCredential = z.infer<typeof createApiCredentialSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
});

const screenplayTitleSchema = z.string().trim().min(1).max(160);
export const screenplayPaperSizeSchema = z.enum(['letter', 'a4']);
export type ScreenplayPaperSize = z.infer<typeof screenplayPaperSizeSchema>;
export const FOUNTAIN_SOURCE_MAX_CHARACTERS = 5_000_000;
export const SCREENPLAY_LIST_DEFAULT_LIMIT = 50;
export const SCREENPLAY_LIST_MAX_LIMIT = 100;
const fountainSourceSchema = z
  .string()
  .max(FOUNTAIN_SOURCE_MAX_CHARACTERS)
  .describe('Canonical UTF-8 Fountain source text.');

export const createScreenplaySchema = z.object({
  title: screenplayTitleSchema,
  sourceText: fountainSourceSchema.optional(),
  paperSize: screenplayPaperSizeSchema.optional(),
});
export type CreateScreenplay = z.infer<typeof createScreenplaySchema>;

export const updateScreenplaySchema = z
  .object({
    title: screenplayTitleSchema.optional(),
    sourceText: fountainSourceSchema.optional(),
    paperSize: screenplayPaperSizeSchema.optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.sourceText !== undefined || value.paperSize !== undefined,
    {
      message: 'At least one screenplay field is required',
    },
  );
export type UpdateScreenplay = z.infer<typeof updateScreenplaySchema>;

export const createScreenplayCheckpointSchema = z.object({
  version: z.number().int().min(1),
});
export type CreateScreenplayCheckpoint = z.infer<typeof createScreenplayCheckpointSchema>;

export const screenplayCheckpointSchema = z.object({
  id: z.string().uuid(),
  screenplayId: z.string().uuid(),
  screenplayVersion: z.number().int().min(1),
  filename: z.string().min(1).max(255),
  paperSize: screenplayPaperSizeSchema,
  sourceByteLength: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
});
export type ScreenplayCheckpoint = z.infer<typeof screenplayCheckpointSchema>;

export const importScreenplaySchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((filename) => /\.(?:fountain|spmd|txt)$/i.test(filename), {
      message: 'Filename must use .fountain, .spmd, or .txt',
    })
    .describe('Fountain-compatible filename ending in .fountain, .spmd, or .txt.'),
  sourceText: fountainSourceSchema,
  paperSize: screenplayPaperSizeSchema.optional(),
});
export type ImportScreenplay = z.infer<typeof importScreenplaySchema>;

export const listScreenplaysQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCREENPLAY_LIST_MAX_LIMIT)
    .default(SCREENPLAY_LIST_DEFAULT_LIMIT),
});
export type ListScreenplaysQuery = z.infer<typeof listScreenplaysQuerySchema>;

export const projectTemplateIdSchema = z.enum(['movie', 'tv_series', 'comic']);
export type ProjectTemplateId = z.infer<typeof projectTemplateIdSchema>;
export const createProjectFromTemplateSchema = createProjectSchema.extend({
  templateId: projectTemplateIdSchema,
});

export const updateProjectSchema = createProjectSchema
  .partial()
  .extend({ version: z.number().int().min(1) });

export const createInvitationSchema = z.object({ email: emailSchema, roleId: uuidSchema });

export const instanceManagementListQuerySchema = z.object({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(160).optional(),
});

export const createInstanceInvitationSchema = z
  .object({
    email: emailSchema,
    expiresIn: z.enum(['never', '30_days', '7_days', '24_hours']).default('never'),
    projectId: uuidSchema.nullish(),
    roleId: uuidSchema.nullish(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.projectId) === Boolean(value.roleId)) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.projectId ? ['roleId'] : ['projectId'],
      message: 'Project and role must be selected together',
    });
  });

export const createBulkInstanceInvitationSchema = z
  .object({
    expiresIn: z.enum(['30_days', '7_days', '24_hours']),
    projectId: uuidSchema.nullish(),
    roleId: uuidSchema.nullish(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.projectId) === Boolean(value.roleId)) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.projectId ? ['roleId'] : ['projectId'],
      message: 'Project and role must be selected together',
    });
  });

export const updateInstanceUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z
    .array(permissionSchema)
    .min(1)
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: 'Permissions must be unique',
    }),
});

export const updateRoleSchema = createRoleSchema
  .partial()
  .extend({ version: z.number().int().min(1) });

export const archiveRoleSchema = z.object({ version: z.number().int().min(1) });

export const updateMembershipSchema = z.object({
  roleId: uuidSchema,
  version: z.number().int().min(1),
});

export const createMembershipSchema = z.object({
  userId: uuidSchema,
  roleId: uuidSchema,
});

export const removeMembershipSchema = z.object({
  version: z.number().int().min(1),
});

export const transferOwnershipSchema = z.object({
  newOwnerMembershipId: uuidSchema,
  version: z.number().int().min(1),
});

export const createEntityTypeSchema = z.object({
  singularName: z.string().trim().min(1).max(80),
  pluralName: z.string().trim().min(1).max(80),
  displayPrefix: z.string().trim().max(20).nullable().optional(),
});

export const updateEntityTypeSchema = createEntityTypeSchema
  .partial()
  .extend({ version: z.number().int().min(1) });

export const createItemSchema = z.object({
  entityTypeId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1).max(300),
  displayCode: z.string().trim().max(80).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  beforeId: uuidSchema.optional(),
  afterId: uuidSchema.optional(),
});

export const updateItemSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  displayCode: z.string().trim().max(80).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  parentId: uuidSchema.nullable().optional(),
  version: z.number().int().min(1),
});

export const reorderSchema = z.object({
  beforeId: uuidSchema.nullable().optional(),
  afterId: uuidSchema.nullable().optional(),
  parentId: uuidSchema.nullable().optional(),
  version: z.number().int().min(1),
});

export const reorderFieldSchema = reorderSchema.omit({ parentId: true });

export const fieldConfigurationSchema = z.record(z.string(), z.unknown()).default({});

export const createFieldOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  color: z.string().trim().max(32).nullable().optional(),
});

export const updateFieldOptionSchema = createFieldOptionSchema.extend({
  id: uuidSchema.optional(),
});

const validateFieldOptions = (
  type: FieldType,
  options: Array<{ label: string }> | undefined,
  context: z.RefinementCtx,
) => {
  if (options?.length && type !== 'enum' && type !== 'multi_enum') {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'Options are only supported by enum and multi-enum fields',
    });
  }
  if (options) {
    const labels = options.map((option) => option.label.toLocaleLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Option labels must be unique',
      });
    }
  }
};

export const createFieldDefinitionSchema = z
  .object({
    entityTypeId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/),
    type: fieldTypeSchema,
    required: z.boolean().default(false),
    configuration: fieldConfigurationSchema.optional(),
    options: z.array(createFieldOptionSchema).max(250).optional(),
  })
  .superRefine((field, context) => validateFieldOptions(field.type, field.options, context));

export const updateFieldDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  required: z.boolean().optional(),
  configuration: fieldConfigurationSchema.optional(),
  options: z.array(updateFieldOptionSchema).max(250).optional(),
  version: z.number().int().min(1),
});

export const archiveFieldDefinitionSchema = z.object({
  version: z.number().int().min(1),
});

export const fieldValueInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('long_text'), value: z.string() }),
  z.object({
    type: z.literal('integer'),
    value: z.number().int().min(-2147483648).max(2147483647),
  }),
  z.object({ type: z.literal('float'), value: z.number().finite() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({ type: z.literal('date'), value: isoDateSchema }),
  z.object({ type: z.literal('enum'), optionId: uuidSchema }),
  z.object({
    type: z.literal('multi_enum'),
    optionIds: z
      .array(uuidSchema)
      .max(100)
      .refine((optionIds) => new Set(optionIds).size === optionIds.length, {
        message: 'Option IDs must be unique',
      }),
  }),
  z.object({ type: z.enum(['file', 'image', 'video']), storageObjectId: uuidSchema }),
]);
export type FieldValueInput = z.infer<typeof fieldValueInputSchema>;

export const setFieldValueSchema = z.object({
  value: fieldValueInputSchema.nullable(),
  itemVersion: z.number().int().min(1),
});

export const itemFilterSchema = z
  .object({
    fieldId: uuidSchema,
    operator: z.enum([
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
    ]),
    value: z.unknown().optional(),
  })
  .superRefine((filter, context) => {
    if (
      filter.operator !== 'is_empty' &&
      filter.operator !== 'is_not_empty' &&
      filter.value === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A value is required for this filter operator',
      });
    }
  });
export type ItemFilter = z.infer<typeof itemFilterSchema>;

const itemFiltersQuerySchema = z.preprocess((value) => {
  if (value === undefined) return [];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { invalid: 'filters must be a JSON array' };
  }
}, z.array(itemFilterSchema).max(20));

export const listItemsQuerySchema = z.object({
  entityTypeId: uuidSchema,
  parentId: uuidSchema.nullable().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  sort: z.enum(['manual', 'title', 'code', 'created_at', 'updated_at']).default('manual'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(200).optional(),
  filters: itemFiltersQuerySchema.default([]),
});

export const createUploadSchema = z.object({
  kind: storageKindSchema,
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  projectId: uuidSchema,
});

export const completeUploadSchema = z.object({ version: z.number().int().min(1) });

// --- Storage settings wizard -------------------------------------------------
// Defined in the leaf module ./storage-wizard (re-exported at the top of this
// file) so the scheduled-backup contracts can reuse the connection and probe
// shapes without a circular import.

// --- Scheduled backups -------------------------------------------------------
// Schedule, retention, view, and history contracts live in ./scheduled-backup
// (re-exported below). Only the destination-input schema stays here because it
// reuses the storage-wizard connection shape defined above.

/** A candidate dedicated destination reuses the storage wizard connection shape. */
export const scheduledBackupDestinationInputSchema = storageConnectionInputSchema;
export type ScheduledBackupDestinationInput = z.infer<typeof scheduledBackupDestinationInputSchema>;

export const createSourceDocumentSchema = z.object({
  storageObjectId: uuidSchema,
  title: z.string().trim().min(1).max(255),
});

export const createSourceReferenceSchema = z
  .object({
    sourceDocumentId: uuidSchema,
    startPage: z.number().int().min(1),
    endPage: z.number().int().min(1),
  })
  .refine((value) => value.endPage >= value.startPage, {
    message: 'endPage must be at least startPage',
    path: ['endPage'],
  });

export const createCommentSchema = z.object({ body: z.string().trim().min(1).max(10000) });
export const updateCommentSchema = createCommentSchema.extend({ version: z.number().int().min(1) });

export const cursorSchema = z.object({ rank: z.string(), id: uuidSchema });

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

export interface RealtimeInvalidation {
  projectId: string;
  resource: string;
  ids: string[];
  revision: number;
}
