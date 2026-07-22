import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  completeUploadSchema,
  createSourceDocumentSchema,
  createSourceReferenceSchema,
  createUploadSchema,
} from '@coda/contracts';
import { StorageService } from './storage.service';
import { DocumentsService } from './documents.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('api/v1')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('uploads')
  async create(@Req() request: Request, @Body() body: unknown) {
    const input = createUploadSchema.parse(body);
    const object = await this.storage.createUpload(request.user!.id, input);
    await this.realtime.invalidateProject(input.projectId, 'storage-objects', [object.id]);
    return {
      data: object,
    };
  }

  @Post('projects/:projectId/uploads/:storageObjectId/complete')
  async complete(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('storageObjectId') id: string,
    @Body() body: unknown,
  ) {
    const input = completeUploadSchema.parse(body);
    const object = await this.storage.completeUpload(
      request.user!.id,
      projectId,
      id,
      input.version,
    );
    await this.realtime.invalidateProject(projectId, 'storage-objects', [id]);
    return {
      data: object,
    };
  }

  @Get('projects/:projectId/storage-objects/:storageObjectId/content')
  async content(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('storageObjectId') id: string,
  ) {
    return { data: await this.storage.readUrl(request.user!.id, projectId, id) };
  }

  @Post('projects/:projectId/source-documents')
  async document(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const document = await this.documents.create(
      request.user!.id,
      projectId,
      createSourceDocumentSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'source-documents', [document.id]);
    return {
      data: document,
    };
  }

  @Post('projects/:projectId/items/:itemId/source-references')
  async reference(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    const reference = await this.documents.addReference(
      request.user!.id,
      projectId,
      itemId,
      createSourceReferenceSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'source-references', [reference.id, itemId]);
    return {
      data: reference,
    };
  }
}
