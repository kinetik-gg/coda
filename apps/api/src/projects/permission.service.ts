import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Permission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { spaceResourceRegistry } from '../spaces/space-resource-registry';
import { SpaceResourcesService } from '../spaces/space-resources.service';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
    private readonly spaceResources?: SpaceResourcesService,
  ) {}

  async membership(userId: string, projectId: string) {
    const credential = this.authContext.credential();
    if (credential && (credential.userId !== userId || credential.projectId !== projectId)) {
      throw new NotFoundException('Project not found');
    }
    const directMembership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      include: { role: { include: { permissions: true } }, project: true },
    });
    if (
      directMembership &&
      !directMembership.project.deletedAt &&
      !directMembership.role.archivedAt
    ) {
      return directMembership;
    }
    if (credential) throw new NotFoundException('Project not found');

    const [spaceMembership, project] = await Promise.all([
      this.spaceResources
        ? this.spaceResources.resolveActiveMembership(userId, 'breakdown', projectId)
        : null,
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerUserId: true, deletedAt: true },
      }),
    ]);
    if (!spaceMembership || !project || project.deletedAt) {
      throw new NotFoundException('Project not found');
    }
    const permissions = spaceResourceRegistry.breakdown
      .tierPermissions(spaceMembership.role.resourceTier)
      .map((permission) => ({ permission }));
    return {
      ...spaceMembership,
      projectId,
      project,
      role: { ...spaceMembership.role, isOwner: false, permissions },
    };
  }

  async assert(userId: string, projectId: string, permission: Permission) {
    const credential = this.authContext.credential();
    if (credential && !credential.permissions.includes(permission)) {
      throw new ForbiddenException(`Credential scope does not permit: ${permission}`);
    }
    const membership = await this.membership(userId, projectId);
    if (!membership.role.permissions.some((entry) => entry.permission === permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return membership;
  }
}
