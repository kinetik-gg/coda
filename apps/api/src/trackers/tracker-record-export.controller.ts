import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { exportTrackerRecordsQuerySchema } from '@coda/contracts';
import { TrackerRecordsService } from './tracker-records.service';

/**
 * The tracker record CSV download. Streams the same record set as the list endpoint — identical
 * filter/search/sort parameters, default manual order — and releases its export admission slot
 * when the response ends or the client stalls.
 */
@Controller('api/v1/trackers/:trackerId/exports')
export class TrackerRecordExportsController {
  constructor(private readonly records: TrackerRecordsService) {}

  @Get('records.csv')
  async csv(
    @Req() request: Request,
    @Res() response: Response,
    @Param('trackerId') trackerId: string,
    @Query() query: unknown,
  ) {
    const result = await this.records.exportCsv(
      request.user!.id,
      trackerId,
      exportTrackerRecordsQuerySchema.parse(query),
    );
    try {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      await pipeline(Readable.from(result.content, { objectMode: false }), response);
    } finally {
      result.release();
    }
  }
}
