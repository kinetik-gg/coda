import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { buildExternalOpenApiDocument } from './external-openapi';

@Controller('api/v1')
export class ExternalApiDocsController {
  @Public()
  @Get('openapi.json')
  document() {
    return buildExternalOpenApiDocument();
  }
}
