import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ExportsService } from './exports.service';

@Controller('api/v1/projects/:projectId/exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('levels/:entityTypeId.csv')
  async csv(
    @Req() request: Request,
    @Res() response: Response,
    @Param('projectId') projectId: string,
    @Param('entityTypeId') entityTypeId: string,
  ) {
    const result = await this.exportsService.levelCsv(request.user!.id, projectId, entityTypeId);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.send(result.content);
  }

  @Get('project.json')
  async json(
    @Req() request: Request,
    @Res() response: Response,
    @Param('projectId') projectId: string,
  ) {
    const content = await this.exportsService.projectJson(request.user!.id, projectId);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="project.json"');
    response.send(content);
  }
}
