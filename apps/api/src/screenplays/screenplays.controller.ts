import { Body, Controller, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  createScreenplaySchema,
  importScreenplaySchema,
  updateScreenplaySchema,
} from '@coda/contracts';
import { safeDownloadFilename } from './screenplay-filename';
import { ScreenplaysService } from './screenplays.service';

@Controller('api/v1/screenplays')
export class ScreenplaysController {
  constructor(private readonly screenplays: ScreenplaysService) {}

  @Get()
  async list(@Req() request: Request) {
    return { data: await this.screenplays.list(request.user!.id) };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.screenplays.create(request.user!.id, createScreenplaySchema.parse(body)),
    };
  }

  @Post('import')
  async import(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.screenplays.import(request.user!.id, importScreenplaySchema.parse(body)),
    };
  }

  @Get(':screenplayId')
  async get(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.screenplays.get(request.user!.id, screenplayId) };
  }

  @Patch(':screenplayId')
  async update(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.screenplays.update(
        request.user!.id,
        screenplayId,
        updateScreenplaySchema.parse(body),
      ),
    };
  }

  @Get(':screenplayId/export.fountain')
  async exportFountain(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const screenplay = await this.screenplays.get(request.user!.id, screenplayId);
    response.type('text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDownloadFilename(screenplay.filename)}"`,
    );
    return screenplay.sourceText;
  }
}
