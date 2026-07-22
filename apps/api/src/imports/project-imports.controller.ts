import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectImportAdmission } from './project-import-admission';
import { ProjectImportsService } from './project-imports.service';

export const PROJECT_IMPORT_MEDIA_TYPE = 'application/vnd.coda.project+json';

@Controller('api/v1/projects')
export class ProjectImportsController {
  constructor(
    private readonly imports: ProjectImportsService,
    private readonly admission: ProjectImportAdmission,
  ) {}

  @Post('import')
  async importProject(
    @Req() request: Request,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== PROJECT_IMPORT_MEDIA_TYPE) {
      throw new BadRequestException(`Project imports require ${PROJECT_IMPORT_MEDIA_TYPE}`);
    }
    if (typeof body !== 'string') throw new BadRequestException('Project import body must be text');
    return this.admission.run(async () => ({
      data: await this.imports.importAsNewProject(request.user!.id, body),
    }));
  }
}
