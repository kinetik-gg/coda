import { z } from 'zod';
import { resourceTypeSchema } from './resource-types';
import { resourceTierSchema, spacePermissionSchema } from './space-permissions';

const spaceNameSchema = z.string().trim().min(1).max(160);
const spaceDescriptionSchema = z.string().trim().max(4_000).nullable().optional();
const spaceUuidSchema = z.string().uuid();
const spaceEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const createSpaceSchema = z.object({
  name: spaceNameSchema,
  description: spaceDescriptionSchema,
});
export type CreateSpace = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z
  .object({
    name: spaceNameSchema.optional(),
    description: spaceDescriptionSchema,
    version: z.number().int().min(1),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'At least one space field is required',
  });
export type UpdateSpace = z.infer<typeof updateSpaceSchema>;

const uniquePermissions = (permissions: string[]) =>
  new Set(permissions).size === permissions.length;

export const createSpaceRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(spacePermissionSchema).min(1).refine(uniquePermissions, {
    message: 'Permissions must be unique',
  }),
  resourceTier: resourceTierSchema,
});
export type CreateSpaceRole = z.infer<typeof createSpaceRoleSchema>;

export const updateSpaceRoleSchema = createSpaceRoleSchema
  .partial()
  .extend({ version: z.number().int().min(1) });
export type UpdateSpaceRole = z.infer<typeof updateSpaceRoleSchema>;

export const archiveSpaceRoleSchema = z.object({ version: z.number().int().min(1) });
export const createSpaceMembershipSchema = z.object({
  userId: spaceUuidSchema,
  roleId: spaceUuidSchema,
});
export const updateSpaceMembershipSchema = z.object({
  roleId: spaceUuidSchema,
  version: z.number().int().min(1),
});
export const removeSpaceMembershipSchema = z.object({ version: z.number().int().min(1) });
export const createSpaceInvitationSchema = z.object({
  email: spaceEmailSchema,
  roleId: spaceUuidSchema,
});

export const moveSpaceResourceSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: spaceUuidSchema,
  targetSpaceId: spaceUuidSchema,
});
export type MoveSpaceResource = z.infer<typeof moveSpaceResourceSchema>;
