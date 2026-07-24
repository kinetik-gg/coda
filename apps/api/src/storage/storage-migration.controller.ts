import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { startStorageMigrationSchema } from '@coda/contracts';
import { StorageMigrationService } from './storage-migration.service';

@Controller('api/v1/instance/storage-migration')
export class StorageMigrationController {
  constructor(private readonly migration: StorageMigrationService) {}

  @Get()
  async status(@Req() request: Request) {
    return { data: await this.migration.status(request.user!.id) };
  }

  @Post('start')
  @HttpCode(200)
  async start(@Req() request: Request, @Body() body: unknown) {
    const input = startStorageMigrationSchema.parse(body);
    return { data: await this.migration.start(request.user!.id, input) };
  }

  @Post('cutover')
  @HttpCode(200)
  async cutover(@Req() request: Request) {
    return { data: await this.migration.cutover(request.user!.id) };
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@Req() request: Request) {
    return { data: await this.migration.cancel(request.user!.id) };
  }
}
