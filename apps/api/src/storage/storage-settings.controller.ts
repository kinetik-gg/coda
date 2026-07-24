import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { applyStorageConfigSchema, validateStorageConfigSchema } from '@coda/contracts';
import { StorageSettingsService } from './storage-settings.service';

@Controller('api/v1/instance/storage-config')
export class StorageSettingsController {
  constructor(private readonly settings: StorageSettingsService) {}

  @Get()
  async describe(@Req() request: Request) {
    return { data: await this.settings.describe(request.user!.id) };
  }

  @Post('validate')
  @HttpCode(200)
  async validate(@Req() request: Request, @Body() body: unknown) {
    const input = validateStorageConfigSchema.parse(body);
    return { data: await this.settings.validate(request.user!.id, input) };
  }

  @Post('apply')
  @HttpCode(200)
  async apply(@Req() request: Request, @Body() body: unknown) {
    const input = applyStorageConfigSchema.parse(body);
    return { data: await this.settings.apply(request.user!.id, input) };
  }

  @Post('revert')
  @HttpCode(200)
  async revert(@Req() request: Request) {
    return { data: await this.settings.revert(request.user!.id) };
  }
}
