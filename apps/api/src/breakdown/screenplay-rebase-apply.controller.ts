import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { applyScreenplayRebaseSchema } from '@coda/contracts';
import { ScreenplayRebaseApplyService } from './screenplay-rebase-apply.service';

/**
 * Applying a reviewed rebase (issue #243).
 *
 * A separate route from the preview, and a `POST` rather than a `PUT`: it is neither safe nor
 * idempotent. Replaying the same body a second time is *refused*, not absorbed — the pins it moved
 * now name a different revision, so the plan it rebuilds no longer matches the fingerprint the body
 * carries and the request answers `409`. That is the intended behaviour. A rebase that silently
 * re-applied would be a rebase that could double-move a pin no one looked at twice.
 *
 * Session-authenticated only, for the same reason as the preview and the pin routes: it needs
 * `read_screenplay` on the linked screenplay, which no project-scoped API credential can ever hold.
 * The route is intentionally absent from the external OpenAPI document.
 */
@Controller('api/v1/projects/:projectId/screenplay-rebase')
export class ScreenplayRebaseApplyController {
  constructor(private readonly rebase: ScreenplayRebaseApplyService) {}

  @Post()
  async apply(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const input = applyScreenplayRebaseSchema.parse(body);
    return { data: await this.rebase.apply(request.user!.id, projectId, input) };
  }
}
