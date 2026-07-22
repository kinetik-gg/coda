import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  archiveRoleSchema,
  createMembershipSchema,
  createInvitationSchema,
  createProjectSchema,
  createProjectFromTemplateSchema,
  createRoleSchema,
  transferOwnershipSchema,
  removeMembershipSchema,
  updateMembershipSchema,
  updateProjectSchema,
  updateRoleSchema,
} from '@coda/contracts';
import { ProjectsService } from './projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('api/v1/projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    return { data: await this.projects.list(request.user!.id) };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return { data: await this.projects.create(request.user!.id, createProjectSchema.parse(body)) };
  }

  @Post('from-template')
  async createFromTemplate(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.projects.createFromTemplate(
        request.user!.id,
        createProjectFromTemplateSchema.parse(body),
      ),
    };
  }

  @Get('creation-options')
  async creationOptions(@Req() request: Request) {
    return { data: await this.projects.creationOptions(request.user!.id) };
  }

  @Get(':projectId')
  async get(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.projects.get(request.user!.id, projectId) };
  }

  @Get(':projectId/management')
  async management(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.projects.management(request.user!.id, projectId) };
  }

  @Patch(':projectId')
  async update(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const project = await this.projects.update(
      request.user!.id,
      projectId,
      updateProjectSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'projects', [projectId]);
    return {
      data: project,
    };
  }

  @Post(':projectId/invitations')
  async invite(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = createInvitationSchema.parse(body);
    const result = await this.projects.invite(
      request.user!.id,
      projectId,
      input.email,
      input.roleId,
    );
    await this.realtime.invalidateProject(projectId, 'invitations', [result.invitation.id]);
    return {
      data: {
        id: result.invitation.id,
        expiresAt: result.invitation.expiresAt,
        invitationUrl: `/accept-invitation?token=${encodeURIComponent(result.token)}`,
      },
    };
  }

  @Post(':projectId/roles')
  async createRole(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const role = await this.projects.createRole(
      request.user!.id,
      projectId,
      createRoleSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'roles', [role.id]);
    return { data: role };
  }

  @Patch(':projectId/roles/:roleId')
  async updateRole(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    const role = await this.projects.updateRole(
      request.user!.id,
      projectId,
      roleId,
      updateRoleSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'roles', [role.id]);
    return { data: role };
  }

  @Delete(':projectId/roles/:roleId')
  async archiveRole(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    const role = await this.projects.archiveRole(
      request.user!.id,
      projectId,
      roleId,
      archiveRoleSchema.parse(body).version,
    );
    await this.realtime.invalidateProject(projectId, 'roles', [role.id]);
    return { data: role };
  }

  @Patch(':projectId/memberships/:membershipId')
  async updateMembership(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = updateMembershipSchema.parse(body);
    const membership = await this.projects.updateMembership(
      request.user!.id,
      projectId,
      membershipId,
      input.roleId,
      input.version,
    );
    await this.realtime.invalidateProject(projectId, 'memberships', [membership.id]);
    return { data: membership };
  }

  @Get(':projectId/available-users')
  async availableUsers(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.projects.availableUsers(request.user!.id, projectId) };
  }

  @Post(':projectId/memberships')
  async addMembership(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = createMembershipSchema.parse(body);
    const membership = await this.projects.addMembership(
      request.user!.id,
      projectId,
      input.userId,
      input.roleId,
    );
    await this.realtime.invalidateProject(projectId, 'memberships', [membership.id]);
    return { data: membership };
  }

  @Delete(':projectId/memberships/:membershipId')
  async removeMembership(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = removeMembershipSchema.parse(body);
    const membership = await this.projects.removeMembership(
      request.user!.id,
      projectId,
      membershipId,
      input.version,
    );
    await this.realtime.invalidateProject(projectId, 'memberships', [membershipId]);
    return { data: membership };
  }

  @Post(':projectId/transfer-ownership')
  async transfer(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = transferOwnershipSchema.parse(body);
    const project = await this.projects.transferOwnership(
      request.user!.id,
      projectId,
      input.newOwnerMembershipId,
      input.version,
    );
    await this.realtime.invalidateProject(projectId, 'memberships', [input.newOwnerMembershipId]);
    return {
      data: project,
    };
  }
}
