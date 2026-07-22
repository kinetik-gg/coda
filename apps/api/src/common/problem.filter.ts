import { ArgumentsHost, Catch, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describeProblem } from './problem-details';
import { sanitizeRequestTarget } from './request-target';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const problem = describeProblem(error, (message) => this.logger.error(message));

    response
      .status(problem.status)
      .type('application/problem+json')
      .send({
        type: `https://coda.local/problems/${problem.status}`,
        ...problem,
        instance: sanitizeRequestTarget(request.originalUrl),
        requestId: request.requestId,
      });
  }
}
