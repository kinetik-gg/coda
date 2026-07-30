import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ScreenplayRebasePreviewService } from './screenplay-rebase-preview.service';

/**
 * The rebase preview (issue #242).
 *
 * **`GET`, and that is a contract, not a convenience.** A preview must be free of side effects, and
 * the safe HTTP method is the plainest way to say so: the route takes no body, is repeatable, and
 * carries no CSRF token because it changes nothing. Choosing `POST` would have made "this writes
 * nothing" a claim in a doc comment; `GET` makes it a property a caller can rely on. The mutation
 * lives in #243, on its own route.
 *
 * Session-authenticated only, for the same reason as the link and pin routes: producing a plan needs
 * `read_screenplay` on the linked screenplay, which no project-scoped API credential can ever hold.
 * The route is intentionally absent from the external OpenAPI document.
 */
@Controller('api/v1/projects/:projectId/screenplay-rebase-preview')
export class ScreenplayRebasePreviewController {
  constructor(private readonly preview: ScreenplayRebasePreviewService) {}

  /**
   * `screenplayVersion` is optional optimistic concurrency: supply the version the editor is
   * showing and a screenplay that has since moved answers `409` instead of returning a plan against
   * text the reviewer never read. Omit it to preview whatever is live right now.
   */
  @Get()
  async get(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Query('screenplayVersion') screenplayVersion?: string,
  ) {
    return {
      data: await this.preview.preview(
        request.user!.id,
        projectId,
        parseScreenplayVersion(screenplayVersion),
      ),
    };
  }
}

/** Rejects a non-numeric or non-positive version rather than letting it degrade into "unspecified". */
function parseScreenplayVersion(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException('screenplayVersion must be a positive integer');
  }
  return version;
}
