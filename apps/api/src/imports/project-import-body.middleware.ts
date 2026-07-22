import { Injectable, type NestMiddleware } from '@nestjs/common';
import { text, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { MAX_PROJECT_IMPORT_BYTES } from './project-import.schema';
import { PROJECT_IMPORT_MEDIA_TYPE } from './project-imports.controller';

const MAX_CONCURRENT_IMPORT_REQUESTS = 2;
const PROJECT_IMPORT_PATH = '/api/v1/projects/import';
export const PROJECT_IMPORT_BODY_TIMEOUT_MS = 60_000;

function problem(response: Response, status: number, title: string, detail: string): void {
  response
    .status(status)
    .type('application/problem+json')
    .send({ type: `https://coda.local/problems/${status}`, title, status, detail });
}

export function createProjectImportBodyMiddleware(
  parser: RequestHandler = text({
    type: PROJECT_IMPORT_MEDIA_TYPE,
    limit: MAX_PROJECT_IMPORT_BYTES,
  }),
  bodyTimeoutMs = PROJECT_IMPORT_BODY_TIMEOUT_MS,
): RequestHandler {
  let active = 0;
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST' || request.path !== PROJECT_IMPORT_PATH) {
      next();
      return;
    }
    if (!request.user) {
      problem(response, 401, 'Unauthorized', 'Authentication is required');
      return;
    }
    if (active >= MAX_CONCURRENT_IMPORT_REQUESTS) {
      problem(response, 503, 'Service Unavailable', 'Project import capacity is full; retry later');
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    let timedOut = false;
    let interrupted = false;
    response.once('close', () => {
      interrupted = true;
      clearTimeout(timeout);
      release();
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      response.once('finish', release);
      response.once('finish', () => request.destroy());
      problem(response, 408, 'Request Timeout', 'Project import body was not received in time');
    }, bodyTimeoutMs);
    timeout.unref();
    const parsed: NextFunction = (error?: unknown) => {
      clearTimeout(timeout);
      release();
      if (!timedOut && !interrupted) next(error);
    };
    try {
      parser(request, response, parsed);
    } catch (error) {
      parsed(error);
    }
  };
}

@Injectable()
export class ProjectImportBodyMiddleware implements NestMiddleware {
  private readonly parse = createProjectImportBodyMiddleware();

  use(request: Request, response: Response, next: NextFunction): void {
    this.parse(request, response, next);
  }
}
