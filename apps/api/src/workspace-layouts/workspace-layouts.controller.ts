import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  publishWorkspaceLayoutSchema,
  resetWorkspaceLayoutSchema,
  saveWorkspaceLayoutSchema,
} from '@coda/contracts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WorkspaceLayoutsService } from './workspace-layouts.service';

@Controller('api/v1/projects/:projectId/workspace-layout')
export class WorkspaceLayoutsController {
  constructor(
    private readonly layouts: WorkspaceLayoutsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async get(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.layouts.get(request.user!.id, projectId) };
  }

  @Put()
  async save(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = saveWorkspaceLayoutSchema.parse(body);
    return {
      data: await this.layouts.save(
        request.user!.id,
        projectId,
        input.layout,
        input.expectedRevision,
      ),
    };
  }

  @Post('reset')
  async reset(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = resetWorkspaceLayoutSchema.parse(body);
    return {
      data: await this.layouts.reset(request.user!.id, projectId, input.expectedRevision),
    };
  }

  @Post('publish')
  async publish(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = publishWorkspaceLayoutSchema.parse(body);
    const published = await this.layouts.publish(
      request.user!.id,
      projectId,
      input.personalRevision,
      input.defaultRevision,
    );
    await this.realtime.invalidateProject(projectId, 'workspace-default', [projectId]);
    return { data: published };
  }
}
