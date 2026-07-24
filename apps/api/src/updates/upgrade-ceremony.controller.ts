import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  coolifyConfigInputSchema,
  redeployWebhookInputSchema,
  triggerRedeploySchema,
} from '@coda/contracts';
import type { Request } from 'express';
import { UpgradeCeremonyService } from './upgrade-ceremony.service';

/**
 * Owner-gated surface for the opt-in upgrade ceremony. Every method authorizes
 * against the instance owner inside the service. Deploy-triggering actions are
 * throttled hard: they take a full backup and/or reach out to the platform.
 */
@Controller('api/v1/updates/ceremony')
export class UpgradeCeremonyController {
  constructor(private readonly ceremony: UpgradeCeremonyService) {}

  @Get()
  async describe(@Req() request: Request) {
    return { data: await this.ceremony.describe(request.user!.id) };
  }

  @Post('backup')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async startBackup(@Req() request: Request) {
    return { data: await this.ceremony.startBackup(request.user!.id) };
  }

  @Post('redeploy')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async triggerRedeploy(@Req() request: Request, @Body() body: unknown) {
    const input = triggerRedeploySchema.parse(body);
    return {
      data: await this.ceremony.triggerRedeploy(request.user!.id, input.confirmedEnvUpdated),
    };
  }

  @Post('coolify/deploy')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async runCoolifyUpgrade(@Req() request: Request) {
    return { data: await this.ceremony.runCoolifyUpgrade(request.user!.id) };
  }

  @Put('webhook')
  @HttpCode(200)
  async setWebhook(@Req() request: Request, @Body() body: unknown) {
    const input = redeployWebhookInputSchema.parse(body);
    return { data: await this.ceremony.setRedeployWebhook(request.user!.id, input) };
  }

  @Delete('webhook')
  async clearWebhook(@Req() request: Request) {
    return { data: await this.ceremony.clearRedeployWebhook(request.user!.id) };
  }

  @Put('coolify')
  @HttpCode(200)
  async setCoolify(@Req() request: Request, @Body() body: unknown) {
    const input = coolifyConfigInputSchema.parse(body);
    return { data: await this.ceremony.setCoolify(request.user!.id, input) };
  }

  @Delete('coolify')
  async clearCoolify(@Req() request: Request) {
    return { data: await this.ceremony.clearCoolify(request.user!.id) };
  }
}
