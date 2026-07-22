import { archiveFieldDefinitionSchema } from '@coda/contracts';
import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TrashService } from './trash.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('api/v1/projects')
export class TrashedProjectsController {
  constructor(private readonly trash: TrashService) {}

  @Get('trash')
  async list(@Req() request: Request) {
    return { data: await this.trash.listTrashedProjects(request.user!.id) };
  }
}

@Controller('api/v1/projects/:projectId')
export class TrashController {
  constructor(
    private readonly trash: TrashService,
    private readonly realtime: RealtimeGateway,
  ) {}
  @Get('trash') async list(@Req() r: Request, @Param('projectId') p: string) {
    return { data: await this.trash.list(r.user!.id, p) };
  }
  @Delete('trash') async trashProject(@Req() r: Request, @Param('projectId') p: string) {
    const project = await this.trash.trashProject(r.user!.id, p);
    await this.realtime.invalidateProject(p, 'projects', [p]);
    return { data: project };
  }
  @Post('restore') async restoreProject(@Req() r: Request, @Param('projectId') p: string) {
    const project = await this.trash.restoreProject(r.user!.id, p);
    await this.realtime.invalidateProject(p, 'projects', [p]);
    return { data: project };
  }
  @Delete('purge') async purgeProject(@Req() r: Request, @Param('projectId') p: string) {
    return { data: await this.trash.purgeProject(r.user!.id, p) };
  }
  @Delete('items/:itemId/trash') async trashItem(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('itemId') i: string,
  ) {
    const result = await this.trash.trashItem(r.user!.id, p, i);
    await this.realtime.invalidateProject(p, 'items', [i]);
    return { data: result };
  }
  @Post('trash/batches/:batchId/restore') async restoreBatch(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('batchId') b: string,
  ) {
    const result = await this.trash.restoreBatch(r.user!.id, p, b);
    await this.realtime.invalidateProject(p, 'items', []);
    return { data: result };
  }
  @Delete('items/:itemId/purge') async purgeItem(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('itemId') i: string,
  ) {
    const result = await this.trash.purgeItem(r.user!.id, p, i);
    await this.realtime.invalidateProject(p, 'items', [i]);
    return { data: result };
  }

  @Delete('fields/:fieldId/trash') async trashField(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('fieldId') id: string,
    @Body() body: unknown,
  ) {
    const result = await this.trash.trashField(
      r.user!.id,
      p,
      id,
      archiveFieldDefinitionSchema.parse(body),
    );
    await this.realtime.invalidateProject(p, 'fields', [id]);
    return { data: result };
  }

  @Post('fields/:fieldId/restore') async restoreField(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('fieldId') id: string,
  ) {
    const result = await this.trash.restoreField(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'fields', [id]);
    return { data: result };
  }

  @Delete('fields/:fieldId/purge') async purgeField(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('fieldId') id: string,
  ) {
    const result = await this.trash.purgeField(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'fields', [id]);
    return { data: result };
  }

  @Delete('source-documents/:documentId/trash') async trashSourceDocument(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('documentId') id: string,
  ) {
    const result = await this.trash.trashSourceDocument(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'source-documents', [id]);
    return { data: result };
  }

  @Post('source-documents/:documentId/restore') async restoreSourceDocument(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('documentId') id: string,
  ) {
    const result = await this.trash.restoreSourceDocument(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'source-documents', [id]);
    return { data: result };
  }

  @Delete('source-documents/:documentId/purge') async purgeSourceDocument(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('documentId') id: string,
  ) {
    const result = await this.trash.purgeSourceDocument(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'source-documents', [id]);
    return { data: result };
  }

  @Delete('storage-objects/:storageObjectId/trash') async trashStorageObject(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('storageObjectId') id: string,
  ) {
    const result = await this.trash.trashStorageObject(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'storage-objects', [id]);
    return { data: result };
  }

  @Post('storage-objects/:storageObjectId/restore') async restoreStorageObject(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('storageObjectId') id: string,
  ) {
    const result = await this.trash.restoreStorageObject(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'storage-objects', [id]);
    return { data: result };
  }

  @Delete('storage-objects/:storageObjectId/purge') async purgeStorageObject(
    @Req() r: Request,
    @Param('projectId') p: string,
    @Param('storageObjectId') id: string,
  ) {
    const result = await this.trash.purgeStorageObject(r.user!.id, p, id);
    await this.realtime.invalidateProject(p, 'storage-objects', [id]);
    return { data: result };
  }
}
