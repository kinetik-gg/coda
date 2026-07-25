import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  createScreenplaySchema,
  createScreenplayCheckpointSchema,
  importScreenplaySchema,
  listScreenplaysQuerySchema,
  updateScreenplaySchema,
} from '@coda/contracts';
import { safeDownloadFilename } from './screenplay-filename';
import { ScreenplayCacheControlInterceptor } from './screenplay-cache-control.interceptor';
import { ScreenplaysService } from './screenplays.service';
import { TrashService } from '../trash/trash.service';

@Controller('api/v1/screenplays')
@UseInterceptors(ScreenplayCacheControlInterceptor)
export class ScreenplaysController {
  constructor(
    private readonly screenplays: ScreenplaysService,
    private readonly trash: TrashService,
  ) {}

  @Get()
  async list(@Req() request: Request, @Query() query: unknown) {
    const result = await this.screenplays.list(
      request.user!.id,
      listScreenplaysQuerySchema.parse(query),
    );
    return { data: result.data, meta: { nextCursor: result.nextCursor } };
  }

  @Get('trash')
  async listTrash(@Req() request: Request) {
    return { data: await this.trash.listTrashedScreenplays(request.user!.id) };
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

  @Post(':screenplayId/checkpoints')
  async checkpoint(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.screenplays.checkpoint(
        request.user!.id,
        screenplayId,
        createScreenplayCheckpointSchema.parse(body),
      ),
    };
  }

  @Get(':screenplayId/checkpoints/:checkpointId/export.fountain')
  async exportCheckpointFountain(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('checkpointId') checkpointId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const checkpoint = await this.screenplays.getCheckpointExport(
      request.user!.id,
      screenplayId,
      checkpointId,
    );
    this.setFountainDownloadHeaders(response, checkpoint.filename);
    return checkpoint.sourceText;
  }

  @Get(':screenplayId/export.fountain')
  async exportFountain(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const screenplay = await this.screenplays.get(request.user!.id, screenplayId);
    this.setFountainDownloadHeaders(response, screenplay.filename);
    return screenplay.sourceText;
  }

  @Delete(':screenplayId')
  async trashScreenplay(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.trash.trashScreenplay(request.user!.id, screenplayId) };
  }

  @Post(':screenplayId/restore')
  async restore(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.trash.restoreScreenplay(request.user!.id, screenplayId) };
  }

  @Delete(':screenplayId/purge')
  async purge(@Req() request: Request, @Param('screenplayId') screenplayId: string) {
    return { data: await this.trash.purgeScreenplay(request.user!.id, screenplayId) };
  }

  private setFountainDownloadHeaders(response: Response, filename: string): void {
    response.type('text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDownloadFilename(filename)}"`,
    );
  }
}
