import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createApiCredentialSchema } from '@coda/contracts';
import type { Request } from 'express';
import { ApiCredentialsService } from './api-credentials.service';

@Controller('api/v1/account/credentials')
export class ApiCredentialsController {
  constructor(private readonly credentials: ApiCredentialsService) {}

  @Get()
  async list(@Req() request: Request) {
    return { data: await this.credentials.list(request.user!.id) };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return {
      data: await this.credentials.create(request.user!.id, createApiCredentialSchema.parse(body)),
    };
  }

  @Delete(':credentialId')
  async revoke(@Req() request: Request, @Param('credentialId') credentialId: string) {
    return { data: await this.credentials.revoke(request.user!.id, credentialId) };
  }
}

@Controller('api/v1/token')
export class ApiCredentialContextController {
  @Get('context')
  context(@Req() request: Request) {
    if (!request.apiCredential) {
      throw new UnauthorizedException('Bearer credential required');
    }
    const credential = request.apiCredential;
    return {
      data:
        credential.resourceType === 'tracker'
          ? {
              resourceType: 'tracker' as const,
              trackerId: credential.trackerId,
              kind: credential.kind,
              permissions: credential.permissions,
            }
          : {
              resourceType: 'project' as const,
              projectId: credential.projectId,
              kind: credential.kind,
              permissions: credential.permissions,
            },
    };
  }
}
