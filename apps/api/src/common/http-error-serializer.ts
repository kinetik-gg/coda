import { HttpException } from '@nestjs/common';

/**
 * Redacted request-error shape used by default. This is the byte-identical
 * historical behavior: a stable error type and a fixed placeholder message with
 * no error detail, status, or stack.
 */
interface RedactedRequestError {
  type: string;
  message: string;
}

/**
 * Opt-in detailed request-error shape. It carries only the sanitized error
 * name, message, and resolved HTTP status, plus a stack trace for 5xx-class
 * errors. It intentionally never includes request bodies, headers, cookies,
 * tokens, or query strings.
 */
interface DetailedRequestError extends RedactedRequestError {
  status: number;
  stack?: string;
}

const DEFAULT_STATUS = 500;
const SERVER_ERROR_STATUS = 500;

function resolveStatus(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const status =
      typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  return DEFAULT_STATUS;
}

/**
 * Build the pino-http `err` serializer.
 *
 * With `includeDetail` false (the default) the serializer reproduces the
 * redacted historical output exactly. With it enabled, entries additionally
 * carry the sanitized error message, resolved HTTP status, and a stack trace
 * for 5xx-class errors only. In neither mode is any request payload, header,
 * cookie, token, or query string emitted.
 */
export function createRequestErrorSerializer(
  includeDetail: boolean,
): (error: unknown) => RedactedRequestError | DetailedRequestError {
  return (error: unknown) => {
    const type = error instanceof Error ? error.name : 'Error';
    if (!includeDetail) {
      return { type, message: 'Request failed' };
    }
    const status = resolveStatus(error);
    const message = error instanceof Error ? error.message : 'Request failed';
    const serialized: DetailedRequestError = { type, message, status };
    if (status >= SERVER_ERROR_STATUS && error instanceof Error && error.stack) {
      serialized.stack = error.stack;
    }
    return serialized;
  };
}
