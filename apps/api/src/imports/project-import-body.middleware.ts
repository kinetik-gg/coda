import { text, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { MAX_PROJECT_IMPORT_BYTES } from './project-import.schema';
import { PROJECT_IMPORT_MEDIA_TYPE } from './project-imports.controller';

const MAX_CONCURRENT_IMPORT_REQUESTS = 2;
const PROJECT_IMPORT_PATH = '/api/v1/projects/import';

export function createProjectImportBodyMiddleware(
  parser: RequestHandler = text({
    type: PROJECT_IMPORT_MEDIA_TYPE,
    limit: MAX_PROJECT_IMPORT_BYTES,
  }),
): RequestHandler {
  let active = 0;
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST' || request.path !== PROJECT_IMPORT_PATH) {
      next();
      return;
    }
    if (active >= MAX_CONCURRENT_IMPORT_REQUESTS) {
      response.status(503).type('application/problem+json').send({
        type: 'https://coda.local/problems/503',
        title: 'Service Unavailable',
        status: 503,
        detail: 'Project import capacity is full; retry later',
      });
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    response.once('finish', release);
    response.once('close', release);
    parser(request, response, next);
  };
}
