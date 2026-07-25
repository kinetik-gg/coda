import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createInvitationSchema,
  createMembershipSchema,
  removeMembershipSchema,
  transferOwnershipSchema,
  updateMembershipSchema,
} from '@coda/contracts';
import { ScreenplayCacheControlInterceptor } from './screenplay-cache-control.interceptor';
import { ScreenplayAccessService } from './screenplay-access.service';

@Controller('api/v1/screenplays')
@UseInterceptors(ScreenplayCacheControlInterceptor)
export class ScreenplayAccessController {
  constructor(private readonly access: ScreenplayAccessService) {}

  @Get(':screenplayId/management')
  async management(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.access.management(request.user!.id, screenplayId) };
  }

  @Post(':screenplayId/invitations')
  async invite(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    const input = createInvitationSchema.parse(body);
    const result = await this.access.invite(
      request.user!.id,
      screenplayId,
      input.email,
      input.roleId,
    );
    return {
      data: {
        id: result.invitation.id,
        expiresAt: result.invitation.expiresAt,
        invitationUrl: `/accept-invitation?token=${encodeURIComponent(result.token)}`,
      },
    };
  }

  @Get(':screenplayId/available-users')
  async availableUsers(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.access.availableUsers(request.user!.id, screenplayId) };
  }

  @Post(':screenplayId/memberships')
  async addMembership(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    const input = createMembershipSchema.parse(body);
    const membership = await this.access.addMembership(
      request.user!.id,
      screenplayId,
      input.userId,
      input.roleId,
    );
    return { data: membership };
  }

  @Patch(':screenplayId/memberships/:membershipId')
  async updateMembership(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = updateMembershipSchema.parse(body);
    const membership = await this.access.updateMembership(
      request.user!.id,
      screenplayId,
      membershipId,
      input.roleId,
      input.version,
    );
    return { data: membership };
  }

  @Delete(':screenplayId/memberships/:membershipId')
  async removeMembership(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    const input = removeMembershipSchema.parse(body);
    const membership = await this.access.removeMembership(
      request.user!.id,
      screenplayId,
      membershipId,
      input.version,
    );
    return { data: membership };
  }

  @Post(':screenplayId/transfer-ownership')
  async transfer(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    const input = transferOwnershipSchema.parse(body);
    const screenplay = await this.access.transferOwnership(
      request.user!.id,
      screenplayId,
      input.newOwnerMembershipId,
      input.version,
    );
    return { data: screenplay };
  }
}
