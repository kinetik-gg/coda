import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { dismissUpdateReleaseSchema, updatePollingPreferenceSchema } from '@coda/contracts';
import type { Request } from 'express';
import { UpdatesService } from './updates.service';

@Controller('api/v1/updates')
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get('status')
  async status(@Req() request: Request) {
    return { data: await this.updates.status(request.user!.id) };
  }

  /** On-demand check is network-bound and owner-triggered; throttled well below the check itself. */
  @Post('check')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async check(@Req() request: Request) {
    return { data: await this.updates.check(request.user!.id) };
  }

  @Put('polling-preference')
  async setPollingPreference(@Req() request: Request, @Body() body: unknown) {
    const input = updatePollingPreferenceSchema.parse(body);
    return {
      data: await this.updates.setPollingPreference(request.user!.id, input.intervalHours),
    };
  }

  @Post('dismiss')
  async dismiss(@Req() request: Request, @Body() body: unknown) {
    const input = dismissUpdateReleaseSchema.parse(body);
    return { data: await this.updates.dismissRelease(request.user!.id, input.version) };
  }
}
