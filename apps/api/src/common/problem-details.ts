import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export interface ProblemDescription {
  status: number;
  title: string;
  detail: string;
  errors?: Record<string, string[]>;
}

const databaseProblems: Record<string, ProblemDescription> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    title: 'Conflict',
    detail: 'A record with the same unique value already exists.',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    title: 'Not Found',
    detail: 'The requested record was not found.',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    title: 'Conflict',
    detail: 'The record is still referenced by other data.',
  },
  P2023: {
    status: HttpStatus.BAD_REQUEST,
    title: 'Bad Request',
    detail: 'A database identifier or value was malformed.',
  },
};

const internalProblem: ProblemDescription = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  title: 'Internal Server Error',
  detail: 'An unexpected error occurred.',
};

function zodProblem(error: ZodError): ProblemDescription {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'request';
    (errors[key] ??= []).push(issue.message);
  }
  return {
    status: HttpStatus.BAD_REQUEST,
    title: 'Validation failed',
    detail: 'The request did not match the required shape.',
    errors,
  };
}

function httpProblem(error: HttpException): ProblemDescription {
  const status = error.getStatus();
  const payload = error.getResponse();
  const message =
    typeof payload === 'object' && payload !== null && 'message' in payload
      ? payload.message
      : undefined;
  const detail =
    typeof payload === 'string' ? payload : typeof message === 'string' ? message : error.message;
  return { status, title: HttpStatus[status] ?? 'Request failed', detail };
}

export function describeProblem(
  error: unknown,
  reportUnhandled: (message: string) => void,
): ProblemDescription {
  if (error instanceof ZodError) return zodProblem(error);
  if (error instanceof HttpException) return httpProblem(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const problem = databaseProblems[error.code];
    if (problem) return problem;
    reportUnhandled(`Unhandled database error (${error.code})`);
    return internalProblem;
  }
  reportUnhandled(
    `Unhandled request error (${error instanceof Error ? error.name : 'UnknownError'})`,
  );
  return internalProblem;
}
