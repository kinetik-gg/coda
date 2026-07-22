import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { sanitizeRequestTarget } from './request-target';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred.';
    let errors: Record<string, string[]> | undefined;

    if (error instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      title = 'Validation failed';
      detail = 'The request did not match the required shape.';
      errors = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || 'request';
        (errors[key] ??= []).push(issue.message);
      }
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      title = HttpStatus[status] ?? 'Request failed';
      const payload = error.getResponse();
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? payload.message
          : undefined;
      detail =
        typeof payload === 'string'
          ? payload
          : typeof message === 'string'
            ? message
            : error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        title = 'Conflict';
        detail = 'A record with the same unique value already exists.';
      } else if (error.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        title = 'Not Found';
        detail = 'The requested record was not found.';
      } else if (error.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        title = 'Conflict';
        detail = 'The record is still referenced by other data.';
      } else if (error.code === 'P2023') {
        status = HttpStatus.BAD_REQUEST;
        title = 'Bad Request';
        detail = 'A database identifier or value was malformed.';
      } else {
        this.logger.error(`Unhandled database error (${error.code})`);
      }
    } else {
      this.logger.error(
        `Unhandled request error (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: `https://coda.local/problems/${status}`,
        title,
        status,
        detail,
        instance: sanitizeRequestTarget(request.originalUrl),
        requestId: request.requestId,
        ...(errors ? { errors } : {}),
      });
  }
}
