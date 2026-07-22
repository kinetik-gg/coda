import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

export const SCREENPLAY_JSON_BODY_LIMIT = '5mb';
export const DEFAULT_REQUEST_BODY_LIMIT = '100kb';

export function installBodyParsers(application: Pick<INestApplication, 'use'>): void {
  application.use('/api/v1/screenplays', json({ limit: SCREENPLAY_JSON_BODY_LIMIT, strict: true }));
  application.use(json({ limit: DEFAULT_REQUEST_BODY_LIMIT, strict: true }));
  application.use(
    urlencoded({ limit: DEFAULT_REQUEST_BODY_LIMIT, extended: true, parameterLimit: 1_000 }),
  );
}
