import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  archiveSpaceRoleSchema,
  createSpaceInvitationSchema,
  createSpaceMembershipSchema,
  createSpaceRoleSchema,
  createSpaceSchema,
  removeSpaceMembershipSchema,
  updateSpaceMembershipSchema,
  updateSpaceRoleSchema,
  updateSpaceSchema,
} from '@coda/contracts';
import { SpacesService } from './spaces.service';

@Controller('api/v1/spaces')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  async list(@Req() request: Request) {
    return { data: await this.spaces.list(request.user!.id) };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return { data: await this.spaces.create(request.user!.id, createSpaceSchema.parse(body)) };
  }

  @Get(':spaceId')
  async get(@Req() request: Request, @Param('spaceId') spaceId: string) {
    return { data: await this.spaces.get(request.user!.id, spaceId) };
  }

  @Patch(':spaceId')
  async update(@Req() request: Request, @Param('spaceId') spaceId: string, @Body() body: unknown) {
    return {
      data: await this.spaces.update(request.user!.id, spaceId, updateSpaceSchema.parse(body)),
    };
  }

  @Delete(':spaceId')
  async remove(@Req() request: Request, @Param('spaceId') spaceId: string) {
    return { data: await this.spaces.remove(request.user!.id, spaceId) };
  }

  @Get(':spaceId/management')
  async management(@Req() request: Request, @Param('spaceId') spaceId: string) {
    return { data: await this.spaces.management(request.user!.id, spaceId) };
  }

  @Post(':spaceId/roles')
  async createRole(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.spaces.createRole(
        request.user!.id,
        spaceId,
        createSpaceRoleSchema.parse(body),
      ),
    };
  }

  @Patch(':spaceId/roles/:roleId')
  async updateRole(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.spaces.updateRole(
        request.user!.id,
        spaceId,
        roleId,
        updateSpaceRoleSchema.parse(body),
      ),
    };
  }

  @Delete(':spaceId/roles/:roleId')
  async archiveRole(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.spaces.archiveRole(
        request.user!.id,
        spaceId,
        roleId,
        archiveSpaceRoleSchema.parse(body).version,
      ),
    };
  }

  @Post(':spaceId/memberships')
  async addMembership(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
  ) {
    const input = createSpaceMembershipSchema.parse(body);
    return {
      data: await this.spaces.addMembership(request.user!.id, spaceId, input.userId, input.roleId),
    };
  }

  @Patch(':spaceId/memberships/:membershipId')
  async updateMembership(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = updateSpaceMembershipSchema.parse(body);
    return {
      data: await this.spaces.updateMembership(
        request.user!.id,
        spaceId,
        membershipId,
        input.roleId,
        input.version,
      ),
    };
  }

  @Delete(':spaceId/memberships/:membershipId')
  async removeMembership(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.spaces.removeMembership(
        request.user!.id,
        spaceId,
        membershipId,
        removeSpaceMembershipSchema.parse(body).version,
      ),
    };
  }

  @Post(':spaceId/invitations')
  async invite(@Req() request: Request, @Param('spaceId') spaceId: string, @Body() body: unknown) {
    const input = createSpaceInvitationSchema.parse(body);
    const result = await this.spaces.invite(request.user!.id, spaceId, input.email, input.roleId);
    return {
      data: {
        id: result.invitation.id,
        expiresAt: result.invitation.expiresAt,
        invitationUrl: `/accept-invitation?token=${encodeURIComponent(result.token)}`,
      },
    };
  }

  @Delete(':spaceId/invitations/:invitationId')
  async revokeInvitation(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return { data: await this.spaces.revokeInvitation(request.user!.id, spaceId, invitationId) };
  }
}
