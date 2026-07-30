import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { linkBreakdownScreenplaySchema } from '@coda/contracts';
import { BreakdownScreenplayLinkService } from './breakdown-screenplay-link.service';

/**
 * The breakdown's screenplay link is a singleton sub-resource: a breakdown follows at most one
 * screenplay, so `PUT` replaces it idempotently and there is no collection to page through.
 *
 * Session-authenticated only in practice. Project-scoped API credentials cannot reach a screenplay
 * (see `ScreenplayPermissionService`), so a credential request gets `404` from the screenplay side
 * on `PUT` and reads the link with `screenplay: null` on `GET`. The route is intentionally absent
 * from the external OpenAPI document for that reason.
 */
@Controller('api/v1/projects/:projectId/screenplay-link')
export class BreakdownScreenplayLinkController {
  constructor(private readonly links: BreakdownScreenplayLinkService) {}

  @Get()
  async get(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.links.get(request.user!.id, projectId) };
  }

  @Put()
  async link(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = linkBreakdownScreenplaySchema.parse(body);
    return { data: await this.links.link(request.user!.id, projectId, input.screenplayId) };
  }

  @Delete()
  async unlink(@Req() request: Request, @Param('projectId') projectId: string) {
    return { data: await this.links.unlink(request.user!.id, projectId) };
  }
}
