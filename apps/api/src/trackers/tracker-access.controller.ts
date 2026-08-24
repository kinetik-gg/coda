import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  archiveRoleSchema,
  createInvitationSchema,
  createMembershipSchema,
  createTrackerRoleSchema,
  removeMembershipSchema,
  transferOwnershipSchema,
  updateMembershipSchema,
  updateTrackerRoleSchema,
} from '@coda/contracts';
import { TrackerAccessService } from './tracker-access.service';

@Controller('api/v1/trackers')
export class TrackerAccessController {
  constructor(private readonly access: TrackerAccessService) {}

  @Get(':trackerId/management')
  async management(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.access.management(request.user!.id, trackerId) };
  }

  @Post(':trackerId/invitations')
  async invite(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = createInvitationSchema.parse(body);
    const result = await this.access.invite(request.user!.id, trackerId, input.email, input.roleId);
    return {
      data: {
        id: result.invitation.id,
        expiresAt: result.invitation.expiresAt,
        invitationUrl: `/accept-invitation?token=${encodeURIComponent(result.token)}`,
      },
    };
  }

  @Delete(':trackerId/invitations/:invitationId')
  async revokeInvitation(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return { data: await this.access.revokeInvitation(request.user!.id, trackerId, invitationId) };
  }

  @Get(':trackerId/available-users')
  async availableUsers(@Req() request: Request, @Param('trackerId') trackerId: string) {
    return { data: await this.access.availableUsers(request.user!.id, trackerId) };
  }

  @Post(':trackerId/memberships')
  async addMembership(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = createMembershipSchema.parse(body);
    const membership = await this.access.addMembership(
      request.user!.id,
      trackerId,
      input.userId,
      input.roleId,
    );
    return { data: membership };
  }

  @Patch(':trackerId/memberships/:membershipId')
  async updateMembership(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = updateMembershipSchema.parse(body);
    const membership = await this.access.updateMembership(
      request.user!.id,
      trackerId,
      membershipId,
      input.roleId,
      input.version,
    );
    return { data: membership };
  }

  @Delete(':trackerId/memberships/:membershipId')
  async removeMembership(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = removeMembershipSchema.parse(body);
    const membership = await this.access.removeMembership(
      request.user!.id,
      trackerId,
      membershipId,
      input.version,
    );
    return { data: membership };
  }

  @Post(':trackerId/roles')
  async createRole(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.access.createRole(
        request.user!.id,
        trackerId,
        createTrackerRoleSchema.parse(body),
      ),
    };
  }

  @Patch(':trackerId/roles/:roleId')
  async updateRole(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.access.updateRole(
        request.user!.id,
        trackerId,
        roleId,
        updateTrackerRoleSchema.parse(body),
      ),
    };
  }

  @Delete(':trackerId/roles/:roleId')
  async archiveRole(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('roleId') roleId: string,
    @Body() body: unknown,
  ) {
    const input = archiveRoleSchema.parse(body);
    return {
      data: await this.access.archiveRole(request.user!.id, trackerId, roleId, input.version),
    };
  }

  @Post(':trackerId/transfer-ownership')
  async transfer(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input = transferOwnershipSchema.parse(body);
    const tracker = await this.access.transferOwnership(
      request.user!.id,
      trackerId,
      input.newOwnerMembershipId,
      input.version,
    );
    return { data: tracker };
  }
}
