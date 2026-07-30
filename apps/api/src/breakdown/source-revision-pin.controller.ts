import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { pinSourceReferenceRevisionSchema } from '@coda/contracts';
import { SourceRevisionPinService } from './source-revision-pin.service';

/**
 * A source reference's revision pin is a singleton sub-resource: a reference is pinned to at most
 * one revision plus range, so `PUT` replaces it idempotently and `DELETE` returns the reference to
 * legacy PDF resolution.
 *
 * Session-authenticated only in practice, for the same reason as the breakdown screenplay link: a
 * project-scoped API credential can never reach a screenplay, so it cannot pin, and it reads a pin
 * back as `unavailable`. The route is intentionally absent from the external OpenAPI document.
 */
@Controller('api/v1/projects/:projectId/items/:itemId/source-references/:referenceId/revision-pin')
export class SourceRevisionPinController {
  constructor(private readonly pins: SourceRevisionPinService) {}

  @Get()
  async get(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Param('referenceId') referenceId: string,
  ) {
    return { data: await this.pins.get(request.user!.id, projectId, itemId, referenceId) };
  }

  @Put()
  async pin(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Param('referenceId') referenceId: string,
    @Body() body: unknown,
  ) {
    const input = pinSourceReferenceRevisionSchema.parse(body);
    return { data: await this.pins.pin(request.user!.id, projectId, itemId, referenceId, input) };
  }

  @Delete()
  async unpin(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Param('referenceId') referenceId: string,
  ) {
    return { data: await this.pins.unpin(request.user!.id, projectId, itemId, referenceId) };
  }
}
