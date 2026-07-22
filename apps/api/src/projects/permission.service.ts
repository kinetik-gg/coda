import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Permission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
  ) {}

  async membership(userId: string, projectId: string) {
    const credential = this.authContext.credential();
    if (credential && (credential.userId !== userId || credential.projectId !== projectId)) {
      throw new NotFoundException('Project not found');
    }
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      include: { role: { include: { permissions: true } }, project: true },
    });
    if (!membership || membership.project.deletedAt)
      throw new NotFoundException('Project not found');
    return membership;
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
