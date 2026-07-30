import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  completeScreenplayImportArtifactSchema,
  convertScreenplayImportArtifactSchema,
  reserveScreenplayImportArtifactSchema,
} from '@coda/contracts';
import { ScreenplayImportConversionService } from './screenplay-import-conversion.service';
import { ScreenplayImportArtifactsService } from './screenplay-import-artifacts.service';

@Controller('api/v1/screenplays/:screenplayId/import-artifacts')
export class ScreenplayImportArtifactsController {
  constructor(
    private readonly artifacts: ScreenplayImportArtifactsService,
    private readonly conversion: ScreenplayImportConversionService,
  ) {}

  @Post()
  async reserve(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.artifacts.reserve(
        request.user!.id,
        screenplayId,
        reserveScreenplayImportArtifactSchema.parse(body),
      ),
    };
  }

  @Post(':artifactId/complete')
  async complete(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.artifacts.complete(
        request.user!.id,
        screenplayId,
        artifactId,
        completeScreenplayImportArtifactSchema.parse(body),
      ),
    };
  }

  /**
   * Converts the uploaded original on the server inside the bounded adapter
   * runtime, then completes the artifact with the result. The alternative to
   * `complete`, for formats whose parsing must not happen on the client.
   */
  @Post(':artifactId/convert')
  async convert(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.conversion.convert(
        request.user!.id,
        screenplayId,
        artifactId,
        convertScreenplayImportArtifactSchema.parse(body),
      ),
    };
  }

  @Get(':artifactId')
  async get(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('artifactId') artifactId: string,
  ) {
    return {
      data: await this.artifacts.get(request.user!.id, screenplayId, artifactId),
    };
  }

  @Get(':artifactId/original')
  async original(
    @Req() request: Request,
    @Param('screenplayId') screenplayId: string,
    @Param('artifactId') artifactId: string,
  ) {
    return {
      data: await this.artifacts.originalReadUrl(request.user!.id, screenplayId, artifactId),
    };
  }
}
