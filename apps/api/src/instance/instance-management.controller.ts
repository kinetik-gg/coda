import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createBulkInstanceInvitationSchema,
  createInstanceInvitationSchema,
  instanceManagementListQuerySchema,
  passwordSchema,
  updateInstanceUserStatusSchema,
} from '@coda/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { InstanceManagementService } from './instance-management.service';

@Controller('api/v1/instance')
export class InstanceManagementController {
  constructor(
    private readonly instance: InstanceManagementService,
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get('access')
  async access(@Req() request: Request) {
    return { data: await this.instance.access(request.user!.id) };
  }

  @Get('management')
  async summary(@Req() request: Request) {
    return { data: await this.instance.summary(request.user!.id) };
  }

  @Get('management/status')
  async liveStatus(@Req() request: Request) {
    return { data: await this.instance.liveStatus(request.user!.id) };
  }

  @Get('management/users')
  async users(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.instance.users(
        request.user!.id,
        instanceManagementListQuerySchema.parse(query),
      ),
    };
  }

  @Get('management/projects')
  async projects(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.instance.projectsList(
        request.user!.id,
        instanceManagementListQuerySchema.parse(query),
      ),
    };
  }

  @Get('management/storage')
  async storage(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.instance.storage(
        request.user!.id,
        instanceManagementListQuerySchema.parse(query),
      ),
    };
  }

  @Get('management/activities')
  async activities(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.instance.activities(
        request.user!.id,
        instanceManagementListQuerySchema.parse(query),
      ),
    };
  }

  @Get('management/jobs')
  async jobs(@Req() request: Request) {
    return { data: await this.instance.jobs(request.user!.id) };
  }

  @Get('management/invitation-options')
  async invitationOptions(@Req() request: Request) {
    return { data: await this.instance.invitationOptions(request.user!.id) };
  }

  @Post('management/invitations')
  async invite(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.instance.invite(
        request.user!.id,
        createInstanceInvitationSchema.parse(body),
      ),
    };
  }

  @Post('management/invitations/bulk')
  async bulkInvite(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.instance.bulkInvite(
        request.user!.id,
        createBulkInstanceInvitationSchema.parse(body),
      ),
    };
  }

  @Get('management/invitations')
  async invitations(@Req() request: Request, @Query() query: unknown) {
    return {
      data: await this.instance.invitations(
        request.user!.id,
        instanceManagementListQuerySchema.parse(query),
      ),
    };
  }

  @Delete('management/invitations/:invitationId')
  async revokeInvitation(@Req() request: Request, @Param('invitationId') invitationId: string) {
    return { data: await this.instance.revokeInvitation(request.user!.id, invitationId) };
  }

  @Post('users/:userId/reset-password')
  async resetUserPassword(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ password: passwordSchema }).parse(body);
    return {
      data: await this.auth.administratorResetPassword(request.user!.id, userId, input.password),
    };
  }

  @Post('users/:userId/reset-2fa')
  async resetUserTwoFactor(@Req() request: Request, @Param('userId') userId: string) {
    return { data: await this.twoFactor.resetForUser(request.user!.id, userId) };
  }

  @Patch('users/:userId/status')
  async updateUserStatus(
    @Req() request: Request,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const input = updateInstanceUserStatusSchema.parse(body);
    return {
      data: await this.instance.updateUserStatus(request.user!.id, userId, input.status),
    };
  }
}
