import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  scheduledBackupDestinationInputSchema,
  scheduledBackupSettingsSchema,
} from '@coda/contracts';
import { ScheduledBackupService } from './scheduled-backup.service';

/**
 * Owner-gated settings, destination, history, and manual-run surface for
 * scheduled backups. Scoped under `scheduled-backups` so it never collides with
 * the download/import backup endpoints. Every method is authorized in the service
 * against the instance owner.
 */
@Controller('api/v1/instance/scheduled-backups')
export class ScheduledBackupController {
  constructor(private readonly scheduled: ScheduledBackupService) {}

  @Get()
  async describe(@Req() request: Request) {
    return { data: await this.scheduled.describe(request.user!.id) };
  }

  @Put('settings')
  @HttpCode(200)
  async updateSettings(@Req() request: Request, @Body() body: unknown) {
    const settings = scheduledBackupSettingsSchema.parse(body);
    return { data: await this.scheduled.updateSettings(request.user!.id, settings) };
  }

  @Post('destination/validate')
  @HttpCode(200)
  async validateDestination(@Req() request: Request, @Body() body: unknown) {
    const input = scheduledBackupDestinationInputSchema.parse(body);
    return { data: await this.scheduled.validateDestination(request.user!.id, input) };
  }

  @Put('destination')
  @HttpCode(200)
  async setDestination(@Req() request: Request, @Body() body: unknown) {
    const input = scheduledBackupDestinationInputSchema.parse(body);
    return { data: await this.scheduled.setDestination(request.user!.id, input) };
  }

  @Delete('destination')
  async clearDestination(@Req() request: Request) {
    return { data: await this.scheduled.clearDestination(request.user!.id) };
  }

  @Post('run')
  @HttpCode(200)
  async run(@Req() request: Request) {
    return { data: await this.scheduled.runNow(request.user!.id) };
  }
}
