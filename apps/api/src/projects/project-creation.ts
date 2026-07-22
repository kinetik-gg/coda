import { allPermissions, type Permission } from '@coda/contracts';
import { ActivityAction, type EntityType, type PrismaClient } from '@prisma/client';
import { evenlySpacedRanks } from '../common/rank';
import type { PrismaService } from '../prisma/prisma.service';
import { createProjectWorkspaceLayouts } from '../workspace-layouts/default-workspace-layout';
import type { ProjectTemplate } from './project-templates';

type Transaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const defaultProjectRoles: Array<{
  name: string;
  permissions: Permission[];
  isOwner?: boolean;
}> = [
  { name: 'owner', permissions: [...allPermissions], isOwner: true },
  {
    name: 'admin',
    permissions: allPermissions.filter((permission) => permission !== 'delete_project'),
  },
  {
    name: 'editor',
    permissions: [
      'read_project',
      'manage_items',
      'manage_source_documents',
      'manage_storage_objects',
      'comment',
    ],
  },
  { name: 'viewer', permissions: ['read_project'] },
];

export function createProject(
  prisma: PrismaService,
  userId: string,
  input: { name: string; description?: string | null },
  template?: ProjectTemplate,
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { ownerUserId: userId, name: input.name, description: input.description },
    });
    const ranks = evenlySpacedRanks(defaultProjectRoles.length);
    const roles = [];
    for (const [index, roleTemplate] of defaultProjectRoles.entries()) {
      roles.push(
        await tx.projectRole.create({
          data: {
            projectId: project.id,
            name: roleTemplate.name,
            isOwner: roleTemplate.isOwner ?? false,
            position: ranks[index]!,
            permissions: {
              create: roleTemplate.permissions.map((permission) => ({ permission })),
            },
          },
        }),
      );
    }
    const ownerMembership = await tx.projectMembership.create({
      data: { projectId: project.id, userId, roleId: roles[0]!.id },
    });
    await createProjectWorkspaceLayouts(tx, project.id, ownerMembership.id);
    if (template) await applyTemplate(tx, project.id, template);
    else {
      await tx.entityType.create({
        data: {
          projectId: project.id,
          singularName: 'Item',
          pluralName: 'Items',
          level: 1,
          position: evenlySpacedRanks(1)[0]!,
        },
      });
    }
    await tx.activityEvent.create({
      data: {
        projectId: project.id,
        actorId: userId,
        action: ActivityAction.CREATED,
        resourceType: 'project',
        resourceId: project.id,
      },
    });
    return project;
  });
}

async function applyTemplate(tx: Transaction, projectId: string, template: ProjectTemplate) {
  const levelRanks = evenlySpacedRanks(template.levels.length);
  let parentTypeId: string | null = null;
  for (const [levelIndex, level] of template.levels.entries()) {
    const entityType: EntityType = await tx.entityType.create({
      data: {
        projectId,
        parentTypeId,
        singularName: level.singularName,
        pluralName: level.pluralName,
        displayPrefix: level.displayPrefix,
        level: levelIndex + 1,
        position: levelRanks[levelIndex]!,
      },
    });
    parentTypeId = entityType.id;
    const fieldRanks = evenlySpacedRanks(level.fields.length);
    for (const [fieldIndex, field] of level.fields.entries()) {
      const optionRanks = evenlySpacedRanks(field.options?.length ?? 0);
      await tx.fieldDefinition.create({
        data: {
          projectId,
          entityTypeId: entityType.id,
          name: field.name,
          key: field.key,
          type: field.type,
          position: fieldRanks[fieldIndex]!,
          options: field.options?.length
            ? {
                create: field.options.map((label, optionIndex) => ({
                  label,
                  position: optionRanks[optionIndex]!,
                })),
              }
            : undefined,
        },
      });
    }
  }
}
