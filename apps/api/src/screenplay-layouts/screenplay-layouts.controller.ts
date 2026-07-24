import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { saveScreenplayLayoutSchema } from '@coda/contracts';
import { ScreenplayLayoutsService } from './screenplay-layouts.service';

@Controller('api/v1/screenplays/:screenplayId/panel-layout')
export class ScreenplayLayoutsController {
  constructor(private readonly layouts: ScreenplayLayoutsService) {}

  @Get()
  async get(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.layouts.get(request.user!.id, screenplayId) };
  }

  @Put()
  async save(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    const input = saveScreenplayLayoutSchema.parse(body);
    return {
      data: await this.layouts.save(
        request.user!.id,
        screenplayId,
        input.layout,
        input.expectedRevision,
      ),
    };
  }
}
