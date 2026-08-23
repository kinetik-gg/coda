import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  completeUploadSchema,
  createTrackerUploadSchema,
  type CreateTrackerUpload,
} from '@coda/contracts';
import { StorageService } from '../storage/storage.service';
import { type StorageOwner } from '../storage/storage-owner';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * The tracker-side mirror of the project upload family (`POST /api/v1/uploads`,
 * `/projects/{projectId}/uploads/{id}/complete`, `/projects/{projectId}/storage-objects/{id}/content`):
 * reserve → PUT to the returned target (presigned or app-proxied per blob driver) → complete.
 * All authorization is delegated to `StorageService`, which routes tracker ownership through
 * `TrackerPermissionService` and stamps exactly one side of the storage-object discriminator.
 *
 * Internal to the web client for now: no API credential can reach a tracker until credential
 * scoping ships (#375), so these routes are session-only by construction. Invalidation follows
 * the resource kind the tracker surface already emits (`'tracker'`).
 */
@Controller('api/v1/trackers/:trackerId')
export class TrackerUploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('uploads')
  async create(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Body() body: unknown,
  ) {
    const input: CreateTrackerUpload = createTrackerUploadSchema.parse(body);
    const object = await this.storage.createUpload(
      request.user!.id,
      input,
      trackerOwner(trackerId),
    );
    await this.realtime.invalidateTracker(trackerId, 'tracker', [object.id]);
    return { data: object };
  }

  @Post('uploads/:uploadId/complete')
  async complete(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('uploadId') uploadId: string,
    @Body() body: unknown,
  ) {
    const input = completeUploadSchema.parse(body);
    const object = await this.storage.completeUpload(
      request.user!.id,
      uploadId,
      input.version,
      trackerOwner(trackerId),
    );
    await this.realtime.invalidateTracker(trackerId, 'tracker', [uploadId]);
    return { data: object };
  }

  @Get('storage-objects/:uploadId/content')
  async content(
    @Req() request: Request,
    @Param('trackerId') trackerId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return {
      data: await this.storage.readUrl(request.user!.id, uploadId, trackerOwner(trackerId)),
    };
  }
}

function trackerOwner(trackerId: string): StorageOwner {
  return { kind: 'tracker', id: trackerId };
}
